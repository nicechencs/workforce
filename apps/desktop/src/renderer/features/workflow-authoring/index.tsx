/**
 * T20 conversational authoring. Importable only: glob registration requires a
 * FeatureSlot, and T11 did not reserve `workflow-authoring`. Do not export
 * `feature` here — that would overwrite the workflows catalog module.
 */
export { WorkflowAuthoringEntry } from "./entry.js";
export { WorkflowAuthoringPage } from "./page.js";
export {
  AUTHORING_PATH,
  AUTHORING_ROUTE_GAP,
  CHAT_SESSION_GAP,
  CHAT_SESSION_PROTOCOL_FROZEN,
  emptyAuthoringModel,
  isWorkflowAuthoringHash,
  landUnpublishedDraft,
  parseStructuredIntent,
  reduceAuthoring,
  rejectChatSubmit,
} from "./model.js";
