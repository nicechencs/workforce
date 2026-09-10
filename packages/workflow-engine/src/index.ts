export const packageName = "@workforce/workflow-engine" as const;

export { InvalidTransitionError } from "./invalid-transition.js";
export {
  nextApprovalStatus,
  nextNodeStatus,
  nextProjectStatus,
  nextRunStatus,
  nextTaskStatus,
  nextWorkflowStatus,
  transitions,
} from "./transitions.js";
export {
  incomingEdges,
  outgoingEdges,
  reachableFrom,
  topologicalOrder,
  validateWorkflowGraph,
  type DagValidation,
} from "./dag.js";
export {
  defaultWaitFor,
  joinSatisfied,
  nodeEligible,
  reviewerCircularWait,
  selectedConditionBranches,
  upstreamSatisfied,
  type NodeRuntimeState,
} from "./eligibility.js";
export { compareReady, schedule, type ScheduleAction, type ScheduleInput } from "./scheduler.js";
export {
  decideRecovery,
  nextBackoffMs,
  type RecoveryDecision,
  type RecoveryInput,
  type RecoveryKind,
} from "./retry.js";
export {
  availableMinor,
  raiseBudget,
  releaseReservation,
  reserveBudget,
  settleUsage,
  type BudgetAmount,
  type BudgetDecision,
  type BudgetState,
} from "./budget.js";
export {
  NODE_INSTANCE_STATUSES,
  NODE_TERMINAL,
  TASK_TERMINAL,
  nodeById,
  type NodeInstanceStatus,
  type JoinPolicy,
  type NodeKind,
  type UpstreamWait,
  type WorkerRole,
  type WorkflowEdgeDefinition,
  type WorkflowGraph,
  type WorkflowNodeDefinition,
} from "./types.js";
