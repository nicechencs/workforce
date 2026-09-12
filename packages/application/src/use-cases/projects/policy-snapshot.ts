import type { ProjectRecord } from "./store.js";

/** In-memory PolicySnapshot facts. Not a fabricated allow/deny decision. */
export const POLICY_SNAPSHOT_SCHEMA = "workforce.policy-snapshot/0.1" as const;
export const APPLICATION_POLICY_VERSION = "0.1.0" as const;

export interface ProjectPolicySnapshot {
  schema: typeof POLICY_SNAPSHOT_SCHEMA;
  policyVersion: string;
  principalId: string;
  organizationId: string;
  projectId: string;
  teamVersionId: string;
  resource: string;
  capturedAt: string;
  runtimeId?: string;
  workspaceId?: string;
  executionNodeId?: string;
  runtimeInstallationId?: string;
  workspaceInstanceId?: string;
  readonly [key: string]: unknown;
}

export function captureProjectPolicySnapshot(input: {
  project: ProjectRecord;
  principalId: string;
  capturedAt: string;
  policyVersion?: string;
}): ProjectPolicySnapshot {
  const snapshot: ProjectPolicySnapshot = {
    schema: POLICY_SNAPSHOT_SCHEMA,
    policyVersion: input.policyVersion ?? APPLICATION_POLICY_VERSION,
    principalId: input.principalId,
    organizationId: input.project.organizationId,
    projectId: input.project.id,
    teamVersionId: input.project.teamVersionId ?? "",
    resource: `project:${input.project.id}`,
    capturedAt: input.capturedAt,
  };
  if (input.project.runtimeId !== undefined) {
    snapshot.runtimeId = input.project.runtimeId;
  }
  if (input.project.workspaceId !== undefined) {
    snapshot.workspaceId = input.project.workspaceId;
  }
  if (input.project.executionNodeId !== undefined) {
    snapshot.executionNodeId = input.project.executionNodeId;
  }
  if (input.project.runtimeInstallationId !== undefined) {
    snapshot.runtimeInstallationId = input.project.runtimeInstallationId;
  }
  if (input.project.workspaceInstanceId !== undefined) {
    snapshot.workspaceInstanceId = input.project.workspaceInstanceId;
  }
  return snapshot;
}
