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
  AUTHORING_RUN_NOT_COMPLETE_NOTE,
  CHAT_SESSION_GAP,
  CHAT_SESSION_PROTOCOL_FROZEN,
  DRAFT_CANVAS_NOTE,
  DRAFT_CANVAS_UNAVAILABLE_NOTE,
  DRAFT_NOT_RUNTIME_NOTE,
  EMPTY_INTENT_NOTE,
  activeAuthoringTurn,
  authoringTurnRefsNote,
  canCancelAuthoringTurn,
  canCloseAuthoringTurn,
  canRetryAuthoringTurn,
  errorMessage,
  isEmptyAuthoringIntent,
  isWorkflowAuthoringHash,
  isAuthoringSessionBoundToProject,
  isUnavailableMessage,
  landedDraftCanvasPath,
  newAuthoringId,
  projectLabel,
  proposalGraphNodeCount,
  proposalTeamSummary,
  proposalWorkflowName,
  resolveAuthoringProjectBinding,
  sessionStatusLabel,
  sessionStatusTone,
  turnStatusLabel,
  turnStatusTone,
  writeCommandOptions,
} from "./model.js";
