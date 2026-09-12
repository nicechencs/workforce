import type {
  ApprovalStatus,
  ProjectStatus,
  RunStatus,
  TaskStatus,
  WorkflowInstanceStatus,
} from "@workforce/domain";

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

export interface NodeRuntimeState {
  nodeId: string;
  status: NodeInstanceStatus;
  taskStatus?: TaskStatus;
  requiredOutputsReady: boolean;
  selected?: boolean;
}

export type ScheduleAction =
  | { type: "make-ready"; nodeId: string }
  | { type: "skip"; nodeId: string }
  | { type: "queue"; nodeId: string }
  | { type: "wait"; reason: string };

export interface BudgetAmount {
  costMinor: number;
  currency: string;
  kind?: "unknown" | "estimated" | "settled";
}

export interface BudgetState {
  currency: string;
  limitMinor: number;
  reservedMinor: number;
  settledMinor: number;
  authorizationVersion: number;
}

export type BudgetDecision =
  | { ok: true; state: BudgetState }
  | {
      ok: false;
      code: "unknown_cost_not_enforceable" | "conflict" | "validation_failed";
      message: string;
    };

export type RecoveryDecision =
  | { action: "wait-capacity" }
  | { action: "retry"; nextAttempt: number; backoffMs: number }
  | { action: "rework"; nextGeneration: number; nextAttempt: 1 }
  | { action: "fail" };

/**
 * T09 use cases call this port. T10 wires the real `@workforce/workflow-engine`
 * functions. Tests inject the same functions so there is only one state matrix.
 */
export interface EnginePort {
  nextProjectStatus(from: ProjectStatus, command: string): ProjectStatus;
  nextTaskStatus(from: TaskStatus, command: string): TaskStatus;
  nextRunStatus(from: RunStatus, command: string): RunStatus;
  nextApprovalStatus(from: ApprovalStatus, command: string): ApprovalStatus;
  nextWorkflowStatus(from: WorkflowInstanceStatus, command: string): WorkflowInstanceStatus;
  nextNodeStatus(from: NodeInstanceStatus, command: string): NodeInstanceStatus;
  validateWorkflowGraph(
    graph: WorkflowGraph,
  ): { ok: true; order: string[] } | { ok: false; reason: string };
  reviewerCircularWait(graph: WorkflowGraph): string | undefined;
  schedule(input: {
    graph: WorkflowGraph;
    nodes: readonly NodeRuntimeState[];
    conditionValues?: Readonly<Record<string, string>>;
    projectStatus: ProjectStatus;
    workflowStatus: WorkflowInstanceStatus;
    capacityAvailable: number;
  }): ScheduleAction[];
  decideRecovery(input: {
    kind: "retry" | "rework";
    attempt: number;
    maxAttempts: number;
    generation: number;
    maxReworkCycles: number;
    capacityAvailable: boolean;
    nowIso?: string;
    nextAttemptAt?: string;
  }): RecoveryDecision;
  taskCompletionBarrier?(input: {
    requiredOutputsBound: boolean;
    artifacts: readonly { status: string }[];
    evaluations: readonly { verdict: string }[];
  }): { ok: true } | { ok: false; reason: string };
  retryIsDue?(nowIso: string, nextAttemptAt: string | undefined): boolean;
  reserveBudget(state: BudgetState, amount: BudgetAmount): BudgetDecision;
  releaseReservation(state: BudgetState, amountMinor: number): BudgetDecision;
  settleUsage(
    state: BudgetState,
    amount: BudgetAmount,
    usageKey: string,
    seenKeys: ReadonlySet<string>,
  ): BudgetDecision & { duplicate: boolean };
  raiseBudget(state: BudgetState, newLimitMinor: number): BudgetDecision;
  nextBackoffMs(attempt: number): number;
}
