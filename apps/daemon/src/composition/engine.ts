import type { EnginePort } from "@workforce/application";
import {
  decideRecovery,
  nextApprovalStatus,
  nextBackoffMs,
  nextNodeStatus,
  nextProjectStatus,
  nextRunStatus,
  nextTaskStatus,
  nextWorkflowStatus,
  raiseBudget,
  releaseReservation,
  reserveBudget,
  retryIsDue,
  reviewerCircularWait,
  schedule,
  settleUsage,
  taskCompletionBarrier,
  validateWorkflowGraph,
} from "@workforce/workflow-engine";

export function createEnginePort(): EnginePort {
  return {
    nextProjectStatus,
    nextTaskStatus,
    nextRunStatus,
    nextApprovalStatus,
    nextWorkflowStatus,
    nextNodeStatus,
    validateWorkflowGraph,
    reviewerCircularWait,
    schedule,
    decideRecovery,
    reserveBudget,
    releaseReservation,
    settleUsage,
    raiseBudget,
    nextBackoffMs,
    taskCompletionBarrier,
    retryIsDue,
  };
}
