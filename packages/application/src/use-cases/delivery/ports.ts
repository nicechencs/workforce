import type { DiffArtifactProposal, WorkspaceInstance } from "../../ports/index.js";

/**
 * T06 integration primitives used by delivery. GitWorkspaceService already
 * implements these methods; tests may fake them.
 */
export interface IntegrationWorkspacePort {
  provisionIntegrationWorkspace(input: {
    taskId: string;
    workspaceId: string;
    baseSha: string;
  }): Promise<WorkspaceInstance>;
  applyPatch(instanceId: string, patch: string): Promise<void>;
  captureDiff(instanceId: string): Promise<DiffArtifactProposal>;
}

export interface PatchContribution {
  nodeId: string;
  runId: string;
  artifactVersionId: string;
  patch: string;
  changedPaths: string[];
  baseSha: string;
}

export interface IntegratePatchesCommand {
  operationId: string;
  projectId: string;
  workspaceId: string;
  integrationTaskId: string;
  baseSha: string;
  workflowVersionId: string;
  contributions: PatchContribution[];
}

export interface ReviewDigestBinding {
  contentDigest: string;
  gate: "artifact";
  workflowVersionId: string;
  workspaceInstanceId: string;
  baseSha: string;
  appliedNodeIds: string[];
  bindToNodeIds: readonly string[];
}

export interface IntegrationConflict {
  nodeId: string;
  message: string;
  requiresHuman: true;
  overlappingPaths?: string[];
}

export interface IntegratedDelivery {
  status: "integrated";
  workspaceInstanceId: string;
  appliedNodeIds: string[];
  contentDigest: string;
  changedPaths: string[];
  patch: string;
  baseSha: string;
  reviewBinding: ReviewDigestBinding;
  pushed: false;
  pullRequestCreated: false;
}

export interface ConflictedDelivery {
  status: "conflict";
  workspaceInstanceId: string;
  appliedNodeIds: string[];
  conflict: IntegrationConflict;
  pushed: false;
  pullRequestCreated: false;
}

export type IntegrationOutcome = IntegratedDelivery | ConflictedDelivery;

export interface IntegrationRecord {
  projectId: string;
  workflowVersionId: string;
  contributionDigest: string;
  outcome: IntegrationOutcome;
  superseded: boolean;
}

export interface IntegrationStore {
  list(projectId: string, workflowVersionId: string): Promise<IntegrationRecord[]>;
  put(record: IntegrationRecord): Promise<void>;
  markSuperseded(projectId: string, workflowVersionId: string): Promise<void>;
}

export interface IntegratePatchesDeps {
  workspace: IntegrationWorkspacePort;
  store: IntegrationStore;
}
