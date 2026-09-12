import type { TaskStatus } from "@workforce/domain";

export const NODE_INSTANCE_STATUSES = [
  "pending",
  "blocked",
  "ready",
  "active",
  "waiting",
  "completed",
  "failed",
  "skipped",
  "cancelled",
] as const;
export type NodeInstanceStatus = (typeof NODE_INSTANCE_STATUSES)[number];

export type NodeKind = "task" | "approval" | "condition" | "parallel";

export type JoinPolicy = "all_success" | "all_terminal" | "min_success";

export type UpstreamWait = "outputs_ready" | "completed" | "failed" | "cancelled" | "any_terminal";

/** Public TaskDto.dependsOn may only project these ordinary prerequisite waits. */
export const PREREQUISITE_WAITS = ["outputs_ready", "completed"] as const;
export type PrerequisiteWait = (typeof PREREQUISITE_WAITS)[number];

export const ROUTING_WAITS = ["failed", "cancelled", "any_terminal"] as const;
export type RoutingWait = (typeof ROUTING_WAITS)[number];

export function isPrerequisiteWait(value: string | undefined): value is PrerequisiteWait {
  const wait = value ?? "outputs_ready";
  return wait === "outputs_ready" || wait === "completed";
}

export type WorkerRole = "planner" | "developer" | "reviewer" | "approver";

export interface WorkflowNodeDefinition {
  id: string;
  kind: NodeKind;
  role?: WorkerRole;
  joinPolicy?: JoinPolicy;
  minSuccess?: number;
  maxAttempts?: number;
  maxReworkCycles?: number;
  requiresReview?: boolean;
  expectedOutputIds?: readonly string[];
  priority?: number;
  conditionKey?: string;
  branches?: readonly { value: string; isDefault?: boolean }[];
}

export interface WorkflowEdgeDefinition {
  id: string;
  from: string;
  to: string;
  waitFor?: UpstreamWait;
  conditionValue?: string;
  inputBindings?: readonly { slotId: string; fromOutputId: string }[];
}

export interface WorkflowGraph {
  id: string;
  workflowId: string;
  version: number;
  entryNodeIds: readonly string[];
  nodes: readonly WorkflowNodeDefinition[];
  edges: readonly WorkflowEdgeDefinition[];
  terminalNodeIds?: readonly string[];
}

export const NODE_TERMINAL = new Set<NodeInstanceStatus>([
  "completed",
  "failed",
  "skipped",
  "cancelled",
]);

export const TASK_TERMINAL = new Set<TaskStatus>(["completed", "failed", "cancelled"]);

export function nodeById(graph: WorkflowGraph, id: string): WorkflowNodeDefinition | undefined {
  return graph.nodes.find((node) => node.id === id);
}
