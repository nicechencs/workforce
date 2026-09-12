/**
 * T20 conversational authoring. Importable only: glob registration requires a
 * FeatureSlot, and T11 did not reserve `workflow-authoring`. Do not export
 * `feature` here — that would overwrite the workflows catalog module.
 */
export { WorkflowAuthoringEntry } from "./entry.js";
export { WorkflowAuthoringPage } from "./page.js";
export {
  AGENT_REPLY_GAP,
  AGENT_SEND_UNAVAILABLE_NOTE,
  AUTHORING_PATH,
  AUTHORING_PROPOSAL_PREVIEW_NOTE,
  AUTHORING_ROUTE_GAP,
  CHAT_SESSION_GAP,
  CHAT_SESSION_PROTOCOL_FROZEN,
  emptyAuthoringModel,
  isWorkflowAuthoringHash,
  landUnpublishedDraft,
  parseStructuredIntent,
  reduceAuthoring,
  rejectAgentGeneration,
  rejectChatSubmit,
  isAuthoringSessionBoundToProject,
  resolveAuthoringProjectBinding,
} from "./model.js";
export {
  AUTHORING_SESSION_STORAGE_KEY,
  DESKTOP_LOCAL_AUTHORING_PROJECT_ID,
  InProcessAuthoringSessionStore,
  createMemoryAuthoringSessionStorage,
  getDefaultAuthoringSessionStore,
  reloadDefaultAuthoringSessionStoreForTests,
  resetDefaultAuthoringSessionStoreForTests,
} from "./session-store.js";
