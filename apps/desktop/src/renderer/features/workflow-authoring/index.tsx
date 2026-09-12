/**
 * T20 conversational authoring. Importable only: glob registration requires a
 * FeatureSlot, and T11 did not reserve `workflow-authoring`. Do not export
 * `feature` here — that would overwrite the workflows catalog module.
 */
export { WorkflowAuthoringEntry } from "./entry.js";
export { WorkflowAuthoringPage } from "./page.js";
export {
  AGENT_REPLY_GAP,
  AUTHORING_PATH,
  AUTHORING_PROPOSAL_PREVIEW_NOTE,
  AUTHORING_ROUTE_GAP,
  CHAT_SESSION_GAP,
  CHAT_SESSION_PROTOCOL_FROZEN,
  activeAuthoringTurn,
  canCancelAuthoringTurn,
  canCloseAuthoringTurn,
  canRetryAuthoringTurn,
  errorMessage,
  isWorkflowAuthoringHash,
  isAuthoringSessionBoundToProject,
  isUnavailableMessage,
  newAuthoringId,
  projectLabel,
  resolveAuthoringProjectBinding,
  sessionStatusLabel,
  turnStatusLabel,
  writeCommandOptions,
} from "./model.js";
