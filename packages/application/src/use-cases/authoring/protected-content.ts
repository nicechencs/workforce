import { validationFailed } from "../projects/errors.js";
import { sha256CanonicalDigest } from "./canonical-digest.js";

export type AuthoringProtectedBodyKind = "session_message" | "intent";

/**
 * Process-local authoring body. SQLite / world snapshots / Events / receipts
 * may only persist `contentRef`, `contentHash`, and `redactedPreview`.
 */
export interface AuthoringProtectedBodyRecord {
  contentRef: string;
  contentHash: string;
  redactedPreview: string;
  /** Transient. Lost on process restart; never copied to durable stores. */
  body: string;
  kind: AuthoringProtectedBodyKind;
  createdAt: string;
  sessionId?: string;
  messageId?: string;
  taskId?: string;
}

export interface AuthoringProtectedBodyStore {
  readonly authoringProtectedBodies: Map<string, AuthoringProtectedBodyRecord>;
  nowIso(): string;
  ids: { ulid(prefix: string): string };
}

export interface StoreAuthoringSessionBodyInput {
  sessionId: string;
  messageId: string;
  content: string;
}

export interface StoreAuthoringIntentInput {
  taskId: string;
  intent: string;
}

export interface AuthoringProtectedBodyRef {
  contentRef: string;
  contentHash: string;
  redactedPreview: string;
}

export function redactAuthoringPreview(contentHash: string): string {
  return `[redacted ${contentHash.slice(0, 19)}]`;
}

export function storeAuthoringSessionBody(
  store: AuthoringProtectedBodyStore,
  input: StoreAuthoringSessionBodyInput,
): AuthoringProtectedBodyRef {
  const content = input.content.trim();
  if (content.length === 0) {
    throw validationFailed("authoring session body is required");
  }
  return putProtectedBody(store, {
    kind: "session_message",
    body: content,
    sessionId: input.sessionId,
    messageId: input.messageId,
  });
}

export function storeAuthoringIntent(
  store: AuthoringProtectedBodyStore,
  input: StoreAuthoringIntentInput,
): AuthoringProtectedBodyRef {
  const intent = input.intent.trim();
  if (intent.length === 0) {
    throw validationFailed("authoring intent is required");
  }
  return putProtectedBody(store, {
    kind: "intent",
    body: intent,
    taskId: input.taskId,
  });
}

/**
 * Fail-closed: a missing body means the transient handoff did not survive.
 * Callers must not report that an Agent received the intent.
 */
export function recoverAuthoringProtectedBody(
  store: AuthoringProtectedBodyStore,
  contentRef: string,
): AuthoringProtectedBodyRecord {
  const record = store.authoringProtectedBodies.get(contentRef);
  if (!record || record.body.trim().length === 0) {
    throw validationFailed("authoring intent is not recoverable after restart", {
      contentRef,
      failClosed: true,
      agentReceivedIntent: false,
    });
  }
  return record;
}

/** Drops the transient body while keeping ref/hash/preview metadata. */
export function dropAuthoringProtectedBody(
  store: AuthoringProtectedBodyStore,
  contentRef: string,
): AuthoringProtectedBodyRef | null {
  const record = store.authoringProtectedBodies.get(contentRef);
  if (!record) return null;
  store.authoringProtectedBodies.delete(contentRef);
  return {
    contentRef: record.contentRef,
    contentHash: record.contentHash,
    redactedPreview: record.redactedPreview,
  };
}

export function authoringProtectedEventData(ref: AuthoringProtectedBodyRef): {
  contentRef: string;
  contentHash: string;
  redactedPreview: string;
} {
  return {
    contentRef: ref.contentRef,
    contentHash: ref.contentHash,
    redactedPreview: ref.redactedPreview,
  };
}

function putProtectedBody(
  store: AuthoringProtectedBodyStore,
  input: {
    kind: AuthoringProtectedBodyKind;
    body: string;
    sessionId?: string;
    messageId?: string;
    taskId?: string;
  },
): AuthoringProtectedBodyRef {
  const contentHash = sha256CanonicalDigest(input.body);
  const contentRef =
    input.kind === "intent"
      ? `transient:authoring:intent:${input.taskId}`
      : `transient:authoring:message:${input.messageId}`;
  const redactedPreview = redactAuthoringPreview(contentHash);
  store.authoringProtectedBodies.set(contentRef, {
    contentRef,
    contentHash,
    redactedPreview,
    body: input.body,
    kind: input.kind,
    createdAt: store.nowIso(),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.messageId ? { messageId: input.messageId } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
  });
  return { contentRef, contentHash, redactedPreview };
}
