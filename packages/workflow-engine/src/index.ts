export const packageName = "@workforce/workflow-engine" as const;

export { InvalidTransitionError } from "./invalid-transition.js";
export {
  nextApprovalStatus,
  nextProjectStatus,
  nextRunStatus,
  nextTaskStatus,
} from "./transitions.js";

