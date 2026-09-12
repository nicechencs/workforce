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
 * Renderer-only notebook/manual-draft key for in-process authoring sessions.
 * It is not a Daemon project resource and must never be treated as an Agent
 * send target. Route-bound project ids are handled separately by the feature.
 */
export const DESKTOP_LOCAL_AUTHORING_PROJECT_ID = "prj_desktop_local";

/** Renderer-local snapshot key. Survives Electron Ctrl+R; not a Daemon chat resource. */
export const AUTHORING_SESSION_STORAGE_KEY = "workforce.d17.authoring-sessions.v0.1";

export interface AuthoringSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface InProcessAuthoringSessionStoreOptions {
  now?: () => string;
  id?: (prefix: string) => string;
  storage?: AuthoringSessionStorage | null;
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
 * Desktop-local session store keyed by authoring session id.
 * Holds messages + draft projection against the frozen D17 DTOs.
 * Optional localStorage snapshot survives Electron renderer reload.
 * No Daemon chat resource, no HTTP path, no Agent/LLM reply loop.
 */
export class InProcessAuthoringSessionStore {
  readonly #sessions = new Map<string, AuthoringSessionDto>();
  readonly #now: () => string;
  readonly #id: (prefix: string) => string;
  readonly #storage: AuthoringSessionStorage | null;

  constructor(options: InProcessAuthoringSessionStoreOptions = {}) {
    this.#now = options.now ?? defaultNow;
    this.#id = options.id ?? defaultId;
    this.#storage = options.storage ?? null;
    this.#hydrate();
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
    this.#persist();
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
    this.#persist();
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
    this.#persist();
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

  #hydrate(): void {
    if (!this.#storage) {
      return;
    }
    let raw: string | null;
    try {
      raw = this.#storage.getItem(AUTHORING_SESSION_STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return;
    }
    const snapshot = parsed as { protocolVersion?: unknown; sessions?: unknown };
    if (snapshot.protocolVersion !== "0.1" || !Array.isArray(snapshot.sessions)) {
      return;
    }
    for (const item of snapshot.sessions) {
      try {
        const session = parseAuthoringSession(item);
        this.#sessions.set(session.id, session);
      } catch {
        // Skip corrupt rows. Do not invent an Agent success session.
      }
    }
  }

  #persist(): void {
    if (!this.#storage) {
      return;
    }
    try {
      this.#storage.setItem(
        AUTHORING_SESSION_STORAGE_KEY,
        JSON.stringify({
          protocolVersion: "0.1",
          sessions: [...this.#sessions.values()],
        }),
      );
    } catch {
      // Best-effort local snapshot. In-memory session remains; no Agent reply.
    }
  }
}

let defaultStore: InProcessAuthoringSessionStore | undefined;

export function getDefaultAuthoringSessionStore(): InProcessAuthoringSessionStore {
  defaultStore ??= new InProcessAuthoringSessionStore({ storage: resolveDefaultStorage() });
  return defaultStore;
}

export function resetDefaultAuthoringSessionStoreForTests(): void {
  const storage = resolveDefaultStorage();
  try {
    storage?.removeItem(AUTHORING_SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
  defaultStore = new InProcessAuthoringSessionStore({ storage });
}

/** Simulate Electron renderer reload: new store instance, same local snapshot. */
export function reloadDefaultAuthoringSessionStoreForTests(): void {
  defaultStore = new InProcessAuthoringSessionStore({ storage: resolveDefaultStorage() });
}

export function resolveAuthoringProjectId(projectId?: string): string {
  const trimmed = projectId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : DESKTOP_LOCAL_AUTHORING_PROJECT_ID;
}

export function createMemoryAuthoringSessionStorage(
  initial: Record<string, string> = {},
): AuthoringSessionStorage {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key: string): string | null {
      return data.has(key) ? (data.get(key) ?? null) : null;
    },
    setItem(key: string, value: string): void {
      data.set(key, value);
    },
    removeItem(key: string): void {
      data.delete(key);
    },
  };
}

export function resolveDefaultStorage(): AuthoringSessionStorage | null {
  try {
    const fromWindow =
      typeof window !== "undefined" && "localStorage" in window ? window.localStorage : undefined;
    const fromGlobal =
      typeof globalThis !== "undefined" && "localStorage" in globalThis
        ? globalThis.localStorage
        : undefined;
    const candidate = fromWindow ?? fromGlobal;
    if (
      candidate &&
      typeof candidate.getItem === "function" &&
      typeof candidate.setItem === "function" &&
      typeof candidate.removeItem === "function"
    ) {
      return candidate;
    }
  } catch {
    return null;
  }
  return null;
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
