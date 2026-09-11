export type Brand<T, B extends string> = T & { readonly __brand: B };

export type OrganizationId = Brand<string, "OrganizationId">;
export type ProjectId = Brand<string, "ProjectId">;
export type TaskId = Brand<string, "TaskId">;
export type RunId = Brand<string, "RunId">;
export type WorkflowInstanceId = Brand<string, "WorkflowInstanceId">;
export type WorkflowNodeId = Brand<string, "WorkflowNodeId">;
export type ArtifactId = Brand<string, "ArtifactId">;
export type ArtifactVersionId = Brand<string, "ArtifactVersionId">;
export type ApprovalId = Brand<string, "ApprovalId">;
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type WorkspaceInstanceId = Brand<string, "WorkspaceInstanceId">;
export type EventId = Brand<string, "EventId">;
export type OperationId = Brand<string, "OperationId">;
export type ExecutionNodeId = Brand<string, "ExecutionNodeId">;
export type RuntimeInstallationId = Brand<string, "RuntimeInstallationId">;
export type PrincipalId = Brand<string, "PrincipalId">;
export type ClientId = Brand<string, "ClientId">;

export const ID_PREFIX = {
  organization: "org_",
  project: "prj_",
  task: "tsk_",
  run: "run_",
  workflowDefinition: "wfd_",
  workflowVersion: "wfv_",
  workflowInstance: "wfi_",
  workflowNode: "wfn_",
  teamDefinition: "tm_",
  teamVersion: "tmv_",
  artifact: "art_",
  artifactVersion: "arv_",
  approval: "apr_",
  workspace: "wsp_",
  workspaceInstance: "wsi_",
  event: "evt_",
  operation: "op_",
  executionNode: "ndl_",
  runtimeInstallation: "rtm_",
  principal: "usr_",
  client: "cli_",
} as const;

export function asId<T extends string>(value: string): T {
  return value as T;
}
