import type {
  ApprovalStatus,
  ProjectStatus,
  RunStatus,
  TaskStatus,
} from "@workforce/domain";

import { InvalidTransitionError } from "./invalid-transition.js";

type Edge<S extends string> = readonly [from: S | "*", command: string, to: S];

function apply<S extends string>(
  entity: string,
  edges: readonly Edge<S>[],
  from: S,
  command: string,
): S {
  const match = edges.find(
    ([start, cmd]) => cmd === command && (start === "*" || start === from),
  );
  if (!match) {
    throw new InvalidTransitionError(entity, from, command);
  }
  const terminal = new Set(["completed", "failed", "cancelled", "archived", "consumed"]);
  if (terminal.has(from) && match[0] !== from) {
    throw new InvalidTransitionError(entity, from, command);
  }
  return match[2];
}

const PROJECT_EDGES = [
  ["draft", "start-planning", "planning"],
  ["planning", "confirm-plan", "ready"],
  ["ready", "start", "running"],
  ["running", "pause", "paused"],
  ["paused", "resume", "running"],
  ["running", "complete", "completed"],
  ["running", "fail", "failed"],
  ["draft", "cancel", "cancelled"],
  ["planning", "cancel", "cancelled"],
  ["ready", "cancel", "cancelled"],
  ["running", "cancel-settled", "cancelled"],
  ["paused", "cancel-settled", "cancelled"],
] as const satisfies readonly Edge<ProjectStatus>[];

const TASK_EDGES = [
  ["draft", "block", "blocked"],
  ["draft", "make-ready", "ready"],
  ["blocked", "make-ready", "ready"],
  ["ready", "queue", "queued"],
  ["queued", "dispatch", "running"],
  ["running", "outputs-ready", "waiting_review"],
  ["running", "auto-complete", "completed"],
  ["running", "retry-ready", "ready"],
  ["running", "fail", "failed"],
  ["queued", "cancel", "cancelled"],
  ["running", "cancel", "cancelled"],
  ["waiting_review", "approve", "completed"],
  ["waiting_review", "request-changes", "ready"],
  ["waiting_review", "reject", "failed"],
] as const satisfies readonly Edge<TaskStatus>[];

const RUN_EDGES = [
  ["pending", "begin-start", "starting"],
  ["starting", "attach", "running"],
  ["running", "wait-input", "waiting_input"],
  ["waiting_input", "input", "running"],
  ["running", "pause", "paused"],
  ["paused", "resume", "running"],
  ["running", "succeed", "succeeded"],
  ["running", "fail", "failed"],
  ["running", "timeout", "timed_out"],
  ["starting", "cancel-settled", "cancelled"],
  ["running", "cancel-settled", "cancelled"],
  ["waiting_input", "cancel-settled", "cancelled"],
  ["paused", "cancel-settled", "cancelled"],
] as const satisfies readonly Edge<RunStatus>[];

const APPROVAL_EDGES = [
  ["pending", "approve", "approved"],
  ["approved", "consume", "consumed"],
  ["pending", "reject", "rejected"],
  ["pending", "request-changes", "changes_requested"],
  ["pending", "expire", "expired"],
  ["pending", "supersede", "superseded"],
  ["approved", "supersede", "superseded"],
  ["pending", "cancel", "cancelled"],
] as const satisfies readonly Edge<ApprovalStatus>[];

export function nextProjectStatus(from: ProjectStatus, command: string): ProjectStatus {
  return apply("project", PROJECT_EDGES, from, command);
}

export function nextTaskStatus(from: TaskStatus, command: string): TaskStatus {
  return apply("task", TASK_EDGES, from, command);
}

export function nextRunStatus(from: RunStatus, command: string): RunStatus {
  return apply("run", RUN_EDGES, from, command);
}

export function nextApprovalStatus(from: ApprovalStatus, command: string): ApprovalStatus {
  return apply("approval", APPROVAL_EDGES, from, command);
}
