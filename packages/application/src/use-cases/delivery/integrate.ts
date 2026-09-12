import { protocolError, type ProtocolError } from "@workforce/protocol";

import { contentDigest, parsePatchPaths } from "./digest.js";
import type {
  IntegratePatchesCommand,
  IntegratePatchesDeps,
  IntegrationOutcome,
  PatchContribution,
  ReviewDigestBinding,
} from "./ports.js";

export class PatchConflictError extends Error {
  override readonly name = "PatchConflictError";
  readonly nodeId?: string;
  readonly overlappingPaths: string[];

  constructor(message: string, options?: { nodeId?: string; overlappingPaths?: string[] }) {
    super(message);
    if (options?.nodeId !== undefined) {
      this.nodeId = options.nodeId;
    }
    this.overlappingPaths = options?.overlappingPaths ?? [];
  }
}

export type IntegratePatchesResult =
  | { ok: true; outcome: IntegrationOutcome; replayed: boolean }
  | { ok: false; error: ProtocolError };

const DEFAULT_BIND_TO = ["review_integration", "approve_delivery"] as const;

function fail(error: ProtocolError): IntegratePatchesResult {
  return { ok: false, error };
}

function sortContributions(contributions: PatchContribution[]): PatchContribution[] {
  return [...contributions].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

function contributionDigest(command: IntegratePatchesCommand): string {
  const ordered = sortContributions(command.contributions).map((item) => ({
    nodeId: item.nodeId,
    artifactVersionId: item.artifactVersionId,
    patch: item.patch,
    baseSha: item.baseSha,
  }));
  return contentDigest({
    workflowVersionId: command.workflowVersionId,
    baseSha: command.baseSha,
    contributions: ordered,
  });
}

function contributionPaths(item: PatchContribution): string[] {
  if (item.changedPaths.length > 0) {
    return item.changedPaths;
  }
  return parsePatchPaths(item.patch);
}

function validateCommand(command: IntegratePatchesCommand): ProtocolError | undefined {
  if (command.contributions.length === 0) {
    return protocolError("validation_failed", "at least one patch contribution is required");
  }
  const seen = new Set<string>();
  for (const item of command.contributions) {
    if (!item.nodeId || !item.patch || !item.baseSha) {
      return protocolError(
        "validation_failed",
        "each contribution needs nodeId, patch, and baseSha",
      );
    }
    if (!item.runId || !item.artifactVersionId) {
      return protocolError(
        "validation_failed",
        "each contribution needs runId and artifactVersionId",
      );
    }
    if (seen.has(item.nodeId)) {
      return protocolError("validation_failed", `duplicate contribution for node ${item.nodeId}`);
    }
    seen.add(item.nodeId);
    if (item.baseSha !== command.baseSha) {
      return protocolError("conflict", "contribution baseSha does not match frozen baseline", {
        details: { nodeId: item.nodeId, expected: command.baseSha, actual: item.baseSha },
      });
    }
  }
  return undefined;
}

async function invalidateApprovalsForDigest(input: {
  deps: IntegratePatchesDeps;
  projectId: string;
  workflowVersionId: string;
  previousDigest: string;
  now: string;
}): Promise<string[]> {
  if (!input.deps.approvals) {
    return [];
  }
  const bindings = await input.deps.approvals.listForWorkflow(
    input.projectId,
    input.workflowVersionId,
  );
  const invalidated: string[] = [];
  for (const binding of bindings) {
    if (binding.gate !== "artifact") {
      continue;
    }
    if (binding.digest !== input.previousDigest) {
      continue;
    }
    if (binding.status === "superseded" || binding.status === "cancelled") {
      continue;
    }
    await input.deps.approvals.supersede(binding.approvalId, input.now);
    invalidated.push(binding.approvalId);
  }
  return invalidated;
}

function digestBindings(input: {
  contentDigest: string;
  workflowVersionId: string;
  workspaceInstanceId: string;
  baseSha: string;
  appliedNodeIds: string[];
  bindToNodeIds: readonly string[];
}): ReviewDigestBinding {
  return {
    contentDigest: input.contentDigest,
    gate: "artifact",
    workflowVersionId: input.workflowVersionId,
    workspaceInstanceId: input.workspaceInstanceId,
    baseSha: input.baseSha,
    appliedNodeIds: input.appliedNodeIds,
    bindToNodeIds: input.bindToNodeIds,
  };
}

export async function integratePatches(
  command: IntegratePatchesCommand,
  deps: IntegratePatchesDeps,
  options?: { bindToNodeIds?: readonly string[] },
): Promise<IntegratePatchesResult> {
  const invalid = validateCommand(command);
  if (invalid) {
    return fail(invalid);
  }

  const digest = contributionDigest(command);
  const previous = await deps.store.list(command.projectId, command.workflowVersionId);
  const replay = previous.find(
    (record) => record.contributionDigest === digest && !record.superseded,
  );
  if (replay) {
    return { ok: true, replayed: true, outcome: replay.outcome };
  }

  const ordered = sortContributions(command.contributions);
  const instance = await deps.workspace.provisionIntegrationWorkspace({
    taskId: command.integrationTaskId,
    workspaceId: command.workspaceId,
    baseSha: command.baseSha,
  });

  const appliedNodeIds: string[] = [];
  const claimedPaths = new Set<string>();
  for (const contribution of ordered) {
    const paths = contributionPaths(contribution);
    const overlappingPaths = paths.filter((path) => claimedPaths.has(path));
    if (overlappingPaths.length > 0) {
      const outcome: IntegrationOutcome = {
        status: "conflict",
        workspaceInstanceId: instance.workspaceInstanceId,
        appliedNodeIds,
        conflict: {
          nodeId: contribution.nodeId,
          message: `overlapping paths ${overlappingPaths.join(",")}`,
          requiresHuman: true,
          overlappingPaths,
        },
        pushed: false,
        pullRequestCreated: false,
      };
      await deps.store.put({
        projectId: command.projectId,
        workflowVersionId: command.workflowVersionId,
        contributionDigest: digest,
        outcome,
        superseded: false,
      });
      return { ok: true, replayed: false, outcome };
    }
    try {
      await deps.workspace.applyPatch(instance.workspaceInstanceId, contribution.patch);
      appliedNodeIds.push(contribution.nodeId);
      for (const path of paths) {
        claimedPaths.add(path);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "patch apply failed";
      const applyOverlap =
        err instanceof PatchConflictError
          ? err.overlappingPaths
          : overlappingPaths.length > 0
            ? overlappingPaths
            : paths;
      const outcome: IntegrationOutcome = {
        status: "conflict",
        workspaceInstanceId: instance.workspaceInstanceId,
        appliedNodeIds,
        conflict: {
          nodeId: contribution.nodeId,
          message,
          requiresHuman: true,
          ...(applyOverlap.length > 0 ? { overlappingPaths: applyOverlap } : {}),
        },
        pushed: false,
        pullRequestCreated: false,
      };
      await deps.store.put({
        projectId: command.projectId,
        workflowVersionId: command.workflowVersionId,
        contributionDigest: digest,
        outcome,
        superseded: false,
      });
      return { ok: true, replayed: false, outcome };
    }
  }

  const captured = await deps.workspace.captureDiff(instance.workspaceInstanceId);
  const content = contentDigest({
    baseSha: captured.baseSha,
    patch: captured.patch,
    changedPaths: captured.changedPaths,
    appliedNodeIds,
  });
  const bindToNodeIds = options?.bindToNodeIds ?? DEFAULT_BIND_TO;
  const binding = digestBindings({
    contentDigest: content,
    workflowVersionId: command.workflowVersionId,
    workspaceInstanceId: instance.workspaceInstanceId,
    baseSha: captured.baseSha,
    appliedNodeIds,
    bindToNodeIds,
  });

  const previousIntegrated = previous.find(
    (record) => !record.superseded && record.outcome.status === "integrated",
  );
  const supersededDigest =
    previousIntegrated && previousIntegrated.outcome.status === "integrated"
      ? previousIntegrated.outcome.contentDigest
      : undefined;
  const invalidatedApprovalIds =
    supersededDigest && supersededDigest !== content
      ? await invalidateApprovalsForDigest({
          deps,
          projectId: command.projectId,
          workflowVersionId: command.workflowVersionId,
          previousDigest: supersededDigest,
          now: new Date().toISOString(),
        })
      : [];

  const outcome: IntegrationOutcome = {
    status: "integrated",
    workspaceInstanceId: instance.workspaceInstanceId,
    appliedNodeIds,
    contentDigest: content,
    changedPaths: captured.changedPaths,
    patch: captured.patch,
    baseSha: captured.baseSha,
    contributors: ordered.map((item) => ({
      nodeId: item.nodeId,
      runId: item.runId,
      artifactVersionId: item.artifactVersionId,
    })),
    reviewBinding: binding,
    acceptanceBinding: binding,
    evaluationBinding: { contentDigest: content, required: true, status: "required" },
    ...(supersededDigest && supersededDigest !== content ? { supersededDigest } : {}),
    invalidatedApprovalIds,
    pushed: false,
    pullRequestCreated: false,
  };

  await deps.store.markSuperseded(command.projectId, command.workflowVersionId);
  await deps.store.put({
    projectId: command.projectId,
    workflowVersionId: command.workflowVersionId,
    contributionDigest: digest,
    outcome,
    superseded: false,
  });

  return { ok: true, replayed: false, outcome };
}

export function previousApprovalStillValid(input: {
  approvedDigest: string;
  currentDigest: string;
}): boolean {
  return input.approvedDigest === input.currentDigest;
}

export function sameDigestBinding(input: {
  reviewDigest: string;
  acceptanceDigest: string;
  evaluationDigest?: string;
}): boolean {
  if (input.reviewDigest !== input.acceptanceDigest) {
    return false;
  }
  if (input.evaluationDigest !== undefined && input.evaluationDigest !== input.reviewDigest) {
    return false;
  }
  return true;
}
