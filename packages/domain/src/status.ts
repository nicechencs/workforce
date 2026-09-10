export const PROJECT_STATUSES = [
  "draft",
  "planning",
  "ready",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "archived",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const WORKFLOW_INSTANCE_STATUSES = [
  "created",
  "validating",
  "ready",
  "running",
  "waiting",
  "paused",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
] as const;
export type WorkflowInstanceStatus = (typeof WORKFLOW_INSTANCE_STATUSES)[number];

export const TASK_STATUSES = [
  "draft",
  "blocked",
  "ready",
  "queued",
  "running",
  "waiting_review",
  "completed",
  "failed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const RUN_STATUSES = [
  "pending",
  "starting",
  "running",
  "waiting_input",
  "paused",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "changes_requested",
  "expired",
  "consumed",
  "superseded",
  "cancelled",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const ARTIFACT_VERSION_STATUSES = [
  "staging",
  "available",
  "quarantined",
  "archived",
] as const;
export type ArtifactVersionStatus = (typeof ARTIFACT_VERSION_STATUSES)[number];

export const COMMAND_RECEIPT_STATUSES = ["pending", "committed", "failed"] as const;
export type CommandReceiptStatus = (typeof COMMAND_RECEIPT_STATUSES)[number];

export const APPROVAL_GATES = ["plan", "artifact", "action", "budget"] as const;
export type ApprovalGate = (typeof APPROVAL_GATES)[number];

export function isRunStatus(value: string): value is RunStatus {
  return (RUN_STATUSES as readonly string[]).includes(value);
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}
