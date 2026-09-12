import {
  parseAuthoringProposal,
  parseAuthoringChangeSet,
  parseTeamDraft,
  parseWorkflowDraft,
  type AuthoringChangeSetDto,
  type AuthoringProposalDto,
  type TeamDraftDto,
  type WorkflowDraftDto,
} from "@workforce/protocol";

import type { AppContext } from "../projects/context.js";
import { notFound, validationFailed } from "../projects/errors.js";
import { appendEvent } from "../projects/events.js";
import { digestOf, withIdempotency } from "../projects/idempotency.js";
import { requireProject } from "../projects/projects.js";
import { startRun } from "../runs/runs.js";

export interface ApplyAuthoringChangeSetInput {
  operationId: string;
  idempotencyKey: string;
  changeSet: AuthoringChangeSetDto;
  workflowDrafts?: readonly WorkflowDraftDto[];
  teamDrafts?: readonly TeamDraftDto[];
}

export interface StartAuthoringInput {
  operationId: string;
  idempotencyKey: string;
  projectId: string;
  /** Used only for Runtime invocation; never copied to events, ChangeSets, or drafts. */
  intent: string;
}

export interface RecordAuthoringProposalInput {
  operationId: string;
  idempotencyKey: string;
  proposal: AuthoringProposalDto;
}

export interface ValidateAuthoringChangeSetInput {
  operationId: string;
  idempotencyKey: string;
  changeSetId: string;
}

/**
 * Creates the governed Task/Run that a Runtime adapter uses for authoring.
 * The intent intentionally remains transient; adapters must return references
 * and a structured Proposal through recordAuthoringProposal instead of logging it.
 */
export async function startAuthoring(
  ctx: AppContext,
  input: StartAuthoringInput,
): Promise<{ reused: boolean; taskId: string; runId: string }> {
  if (input.intent.trim() === "") {
    throw validationFailed("authoring intent is required");
  }
  const taskResult = await ctx.world.uow.withTransaction(async (tx) =>
    withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf({ projectId: input.projectId, intent: input.intent }),
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: "authoring.start",
          resource: `project:${input.projectId}`,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async () => {
        const project = requireProject(ctx, input.projectId);
        const now = ctx.world.nowIso();
        const taskId = ctx.world.ids.ulid("tsk_");
        ctx.world.tasks.set(taskId, {
          id: taskId,
          projectId: project.id,
          role: "planner",
          title: "Authoring proposal",
          status: "ready",
          stateRevision: 1,
          definitionRevision: 1,
          generation: 1,
          attempt: 1,
          maxAttempts: 1,
          maxReworkCycles: 0,
          priority: 0,
          requiresReview: false,
          expectedOutputs: [],
          outputBindings: {},
          dependsOn: [],
          inputArtifactVersionIds: [],
          createdAt: now,
          updatedAt: now,
        });
        await appendEvent(ctx.world, tx, {
          type: "workflow.authoring.started",
          subjectType: "task",
          subjectId: taskId,
          projectId: project.id,
          taskId,
          correlationId: input.operationId,
          data: { phase: "runtime_requested" },
        });
        return { taskId };
      },
    ),
  );
  const run = await startRun(ctx, {
    operationId: `${input.operationId}:run`,
    idempotencyKey: `${input.idempotencyKey}:run`,
    taskId: taskResult.value.taskId,
    snapshotRef: "authoring:proposal",
  });
  return {
    reused: taskResult.reused && run.reused,
    taskId: taskResult.value.taskId,
    runId: run.run.id,
  };
}

/** Runtime adapters call this with validated, reference-only Proposal output. */
export async function recordAuthoringProposal(
  ctx: AppContext,
  input: RecordAuthoringProposalInput,
): Promise<{ reused: boolean; changeSet: AuthoringChangeSetDto }> {
  const proposal = parseAuthoringProposal(input.proposal);
  return ctx.world.uow.withTransaction(async (tx) => {
    const result = await withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf(proposal),
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: "authoring.record-proposal",
          resource: `run:${proposal.sourceRunId}`,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async () => {
        const run = ctx.world.runs.get(proposal.sourceRunId);
        if (!run) throw notFound("source run", proposal.sourceRunId);
        if (run.projectId !== proposal.projectId) {
          throw validationFailed("authoring proposal source run does not belong to the project");
        }
        const project = requireProject(ctx, proposal.projectId);
        const now = ctx.world.nowIso();
        const workflowTargets = proposal.targets.filter(
          (target) => target.targetType === "workflow",
        );
        const changeSet = parseAuthoringChangeSet({
          id: ctx.world.ids.ulid("acs_"),
          organizationId: project.organizationId,
          projectId: project.id,
          ...(workflowTargets.length === 1 ? { workflowId: workflowTargets[0]!.targetId } : {}),
          sourceRunId: run.id,
          status: "proposed",
          proposalRef: proposal.id,
          steps: proposal.targets.map((target, index) => ({
            id: ctx.world.ids.ulid("acst_"),
            ordinal: index + 1,
            targetType: target.targetType,
            targetId: target.targetId,
            expectedRevision: target.expectedRevision,
            status: "pending",
            patchRef: target.patchRef,
          })),
          createdAt: now,
          updatedAt: now,
        });
        ctx.world.authoringChangeSets.set(changeSet.id, changeSet);
        await appendEvent(ctx.world, tx, {
          type: "workflow.authoring.proposed",
          subjectType: "authoring_change_set",
          subjectId: changeSet.id,
          projectId: project.id,
          runId: run.id,
          correlationId: input.operationId,
          data: { proposalId: proposal.id, targetCount: proposal.targets.length },
        });
        return changeSet;
      },
    );
    return { reused: result.reused, changeSet: result.value };
  });
}

/** Validation is explicit so callers cannot skip the proposed → validating boundary. */
export async function validateAuthoringChangeSet(
  ctx: AppContext,
  input: ValidateAuthoringChangeSetInput,
): Promise<{ reused: boolean; changeSet: AuthoringChangeSetDto }> {
  return ctx.world.uow.withTransaction(async (tx) => {
    const result = await withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf({ changeSetId: input.changeSetId }),
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: "authoring.validate-change-set",
          resource: `authoring_change_set:${input.changeSetId}`,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async () => {
        const changeSet = ctx.world.authoringChangeSets.get(input.changeSetId);
        if (!changeSet) throw notFound("authoring change set", input.changeSetId);
        if (changeSet.status !== "proposed") {
          throw validationFailed(`authoring change set cannot validate from ${changeSet.status}`);
        }
        const next = parseAuthoringChangeSet({
          ...changeSet,
          status: "validating",
          updatedAt: ctx.world.nowIso(),
        });
        ctx.world.authoringChangeSets.set(next.id, next);
        await appendEvent(ctx.world, tx, {
          type: "workflow.authoring.validating",
          subjectType: "authoring_change_set",
          subjectId: next.id,
          projectId: next.projectId,
          runId: next.sourceRunId,
          correlationId: input.operationId,
          data: { targetCount: next.steps.length },
        });
        return next;
      },
    );
    return { reused: result.reused, changeSet: result.value };
  });
}

/**
 * Applies a previously validated, structured proposal to authoring drafts.
 * This intentionally has no Runtime call: Runtime proposal creation, task
 * patches, recovery and durable adapter composition are separate slices.
 */
export async function applyAuthoringChangeSet(
  ctx: AppContext,
  input: ApplyAuthoringChangeSetInput,
): Promise<{ reused: boolean; changeSet: AuthoringChangeSetDto }> {
  const requested = parseAuthoringChangeSet(input.changeSet);
  return ctx.world.uow.withTransaction(async (tx) => {
    const result = await withIdempotency(
      ctx.world,
      tx,
      {
        operationId: input.operationId,
        digest: digestOf({
          changeSet: requested,
          workflowDrafts: input.workflowDrafts ?? [],
          teamDrafts: input.teamDrafts ?? [],
        }),
        scope: {
          principalId: ctx.principalId,
          clientId: ctx.clientId,
          canonicalOperation: "authoring.apply-change-set",
          resource: `project:${requested.projectId}`,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async () => {
        const stored = ctx.world.authoringChangeSets.get(requested.id);
        if (!stored) {
          throw notFound("authoring change set", requested.id);
        }
        if (digestOf(stored) !== digestOf(requested)) {
          throw validationFailed("authoring change set differs from its validated record");
        }
        const project = requireProject(ctx, requested.projectId);
        if (project.organizationId !== requested.organizationId) {
          throw validationFailed("authoring change set organization does not match project");
        }
        const sourceRun = ctx.world.runs.get(requested.sourceRunId);
        if (!sourceRun) {
          throw notFound("source run", requested.sourceRunId);
        }
        if (sourceRun.projectId !== requested.projectId) {
          throw validationFailed("authoring source run does not belong to the project");
        }
        if (requested.status !== "validating") {
          throw validationFailed("authoring change set must be validating before apply");
        }
        const workflowDrafts = new Map(
          (input.workflowDrafts ?? []).map((draft) => [
            draft.workflowId,
            parseWorkflowDraft(draft),
          ]),
        );
        const teamDrafts = new Map(
          (input.teamDrafts ?? []).map((draft) => [draft.teamId, parseTeamDraft(draft)]),
        );
        if (
          workflowDrafts.size !== (input.workflowDrafts ?? []).length ||
          teamDrafts.size !== (input.teamDrafts ?? []).length
        ) {
          throw validationFailed("authoring draft targets must be unique");
        }

        for (const step of requested.steps) {
          if (step.status !== "pending") {
            throw validationFailed("authoring change set steps must be pending before apply");
          }
          if (step.targetType === "task") {
            throw validationFailed("task authoring patches are not implemented");
          }
          const draft =
            step.targetType === "workflow"
              ? workflowDrafts.get(step.targetId)
              : teamDrafts.get(step.targetId);
          if (!draft) {
            throw validationFailed(`missing ${step.targetType} draft for ${step.targetId}`);
          }
          assertDraftRevision(
            ctx,
            step.targetType,
            step.targetId,
            draft.revision,
            step.expectedRevision,
          );
          if (
            (step.targetType === "workflow" && ctx.world.workflowDrafts.has(draft.id)) ||
            (step.targetType === "team" && ctx.world.teamDrafts.has(draft.id))
          ) {
            throw validationFailed(`authoring draft ${draft.id} already exists`);
          }
        }

        const now = ctx.world.nowIso();
        for (const draft of workflowDrafts.values()) ctx.world.workflowDrafts.set(draft.id, draft);
        for (const draft of teamDrafts.values()) ctx.world.teamDrafts.set(draft.id, draft);
        const applied = parseAuthoringChangeSet({
          ...requested,
          status: "applied",
          updatedAt: now,
          steps: requested.steps.map((step) => {
            const draft =
              step.targetType === "workflow"
                ? workflowDrafts.get(step.targetId)
                : teamDrafts.get(step.targetId);
            return {
              ...step,
              status: "applied",
              resultRevision: draft?.revision,
              completedAt: now,
            };
          }),
        });
        ctx.world.authoringChangeSets.set(applied.id, applied);
        await appendEvent(ctx.world, tx, {
          type: "workflow.authoring.applied",
          subjectType: "authoring_change_set",
          subjectId: applied.id,
          projectId: applied.projectId,
          runId: applied.sourceRunId,
          correlationId: input.operationId,
          data: { status: applied.status, stepCount: applied.steps.length },
        });
        return applied;
      },
    );
    return { reused: result.reused, changeSet: result.value };
  });
}

function assertDraftRevision(
  ctx: AppContext,
  targetType: "workflow" | "team",
  targetId: string,
  nextRevision: number,
  expectedRevision: number,
): void {
  let currentRevision = 0;
  if (targetType === "workflow") {
    for (const draft of ctx.world.workflowDrafts.values()) {
      if (draft.workflowId === targetId)
        currentRevision = Math.max(currentRevision, draft.revision);
    }
  } else {
    for (const draft of ctx.world.teamDrafts.values()) {
      if (draft.teamId === targetId) currentRevision = Math.max(currentRevision, draft.revision);
    }
  }
  if (currentRevision !== expectedRevision || nextRevision !== currentRevision + 1) {
    throw validationFailed(`authoring ${targetType} draft revision conflict for ${targetId}`, {
      expectedRevision,
      currentRevision,
      nextRevision,
    });
  }
}
