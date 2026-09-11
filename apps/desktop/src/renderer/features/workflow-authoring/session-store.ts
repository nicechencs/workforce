import {
  AUTHORING_SESSION_ID_PREFIX,
  AUTHORING_SESSION_MESSAGE_ID_PREFIX,
  parseAppendAuthoringSessionMessageInput,
  parseAuthoringDraft,
  parseAuthoringSession,
  parseCreateAuthoringSessionInput,
  type AppendAuthoringSessionMessageInput,
  type AuthoringDraftDto,
  type AuthoringSessionDto,
  type AuthoringSessionMessageDto,
  type CreateAuthoringSessionInput,
} from "@workforce/protocol";

/**
 * Desktop-local project binding for in-process authoring sessions.
 * This is not a Daemon project resource and invents no chat HTTP path.
 */
export const DESKTOP_LOCAL_AUTHORING_PROJECT_ID = "prj_desktop_local";

export interface InProcessAuthoringSessionStoreOptions {
  now?: () => string;
  id?: (prefix: string) => string;
}

export class AuthoringSessionNotFoundError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`本机会话 ${sessionId} 不存在。已拒绝写入，没有编造 Agent 回复。`);
    this.name = "AuthoringSessionNotFoundError";
    this.sessionId = sessionId;
  }
}

export class AuthoringSessionClosedError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string, status: AuthoringSessionDto["status"]) {
    super(`本机会话 ${sessionId} 已是 ${status}，不能再追加用户消息。`);
    this.name = "AuthoringSessionClosedError";
    this.sessionId = sessionId;
  }
}

/**
 * In-process / Desktop-local session store keyed by authoring session id.
 * Holds messages + draft projection against the frozen D17 DTOs.
 * No Daemon chat resource, no HTTP path, no Agent/LLM reply loop.
 */
export class InProcessAuthoringSessionStore {
  readonly #sessions = new Map<string, AuthoringSessionDto>();
  readonly #now: () => string;
  readonly #id: (prefix: string) => string;

  constructor(options: InProcessAuthoringSessionStoreOptions = {}) {
    this.#now = options.now ?? defaultNow;
    this.#id = options.id ?? defaultId;
  }

  create(input: CreateAuthoringSessionInput): AuthoringSessionDto {
    const parsed = parseCreateAuthoringSessionInput(input);
    const now = this.#now();
    const messages: AuthoringSessionMessageDto[] = [];
    if (parsed.intentText) {
      messages.push(this.#userMessage(parsed.intentText, now));
    }
    const session = parseAuthoringSession({
      id: this.#id(AUTHORING_SESSION_ID_PREFIX),
      projectId: parsed.projectId,
      protocolVersion: "0.1",
      status: "open",
      messages,
      stateRevision: 1,
      createdAt: now,
      updatedAt: now,
    });
    this.#sessions.set(session.id, session);
    return cloneSession(session);
  }

  load(sessionId: string): AuthoringSessionDto | undefined {
    const session = this.#sessions.get(sessionId);
    return session ? cloneSession(session) : undefined;
  }

  require(sessionId: string): AuthoringSessionDto {
    const session = this.load(sessionId);
    if (!session) {
      throw new AuthoringSessionNotFoundError(sessionId);
    }
    return session;
  }

  appendUserMessage(input: AppendAuthoringSessionMessageInput): AuthoringSessionDto {
    const parsed = parseAppendAuthoringSessionMessageInput(input);
    const current = this.#sessions.get(parsed.sessionId);
    if (!current) {
      throw new AuthoringSessionNotFoundError(parsed.sessionId);
    }
    if (current.status !== "open") {
      throw new AuthoringSessionClosedError(parsed.sessionId, current.status);
    }
    const now = this.#now();
    const next = parseAuthoringSession({
      ...current,
      messages: [...current.messages, this.#userMessage(parsed.content, now)],
      stateRevision: current.stateRevision + 1,
      updatedAt: now,
    });
    this.#sessions.set(next.id, next);
    return cloneSession(next);
  }

  attachDraft(sessionId: string, draft: AuthoringDraftDto): AuthoringSessionDto {
    const current = this.#sessions.get(sessionId);
    if (!current) {
      throw new AuthoringSessionNotFoundError(sessionId);
    }
    const parsedDraft = parseAuthoringDraft(draft);
    const now = this.#now();
    const next = parseAuthoringSession({
      ...current,
      draft: parsedDraft,
      stateRevision: current.stateRevision + 1,
      updatedAt: now,
    });
    this.#sessions.set(next.id, next);
    return cloneSession(next);
  }

  list(): AuthoringSessionDto[] {
    return [...this.#sessions.values()].map(cloneSession);
  }

  #userMessage(content: string, createdAt: string): AuthoringSessionMessageDto {
    return {
      id: this.#id(AUTHORING_SESSION_MESSAGE_ID_PREFIX),
      role: "user",
      content,
      createdAt,
    };
  }
}

let defaultStore: InProcessAuthoringSessionStore | undefined;

export function getDefaultAuthoringSessionStore(): InProcessAuthoringSessionStore {
  defaultStore ??= new InProcessAuthoringSessionStore();
  return defaultStore;
}

export function resetDefaultAuthoringSessionStoreForTests(): void {
  defaultStore = new InProcessAuthoringSessionStore();
}

export function resolveAuthoringProjectId(projectId?: string): string {
  const trimmed = projectId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DESKTOP_LOCAL_AUTHORING_PROJECT_ID;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function defaultId(prefix: string): string {
  const bytes = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random()}`;
  return `${prefix}${bytes.replaceAll("-", "")}`;
}

function cloneSession(session: AuthoringSessionDto): AuthoringSessionDto {
  return parseAuthoringSession({
    ...session,
    messages: session.messages.map((message) => ({ ...message })),
    ...(session.draft ? { draft: { ...session.draft } } : {}),
  });
}
