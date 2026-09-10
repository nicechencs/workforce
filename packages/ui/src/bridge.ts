import type { ConnectionSnapshot } from "./connection.js";

export type ApiMethod = "GET" | "POST" | "PATCH";

export interface ApiRequest {
  method: ApiMethod;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export type ApiResponse =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status: number; code: string; message: string };

export interface WorkspaceGrant {
  authorizationId: string;
  displayLabel: string;
}

export type WorkspacePickResult =
  { ok: true; grant: WorkspaceGrant } | { ok: false; reason: "cancelled" };

export interface EventSubscribeRequest {
  cursor?: string;
  types?: string[];
}

export interface EventSubscriptionRef {
  subscriptionId: string;
}

export interface WorkforcePreloadApi {
  connection: {
    getState(): Promise<ConnectionSnapshot>;
    reconnect(): Promise<ConnectionSnapshot>;
    subscribe(listener: (state: ConnectionSnapshot) => void): () => void;
  };
  api: {
    request(input: ApiRequest): Promise<ApiResponse>;
    subscribeEvents(input: EventSubscribeRequest): Promise<EventSubscriptionRef>;
    unsubscribeEvents(subscriptionId: string): Promise<void>;
    onEvent(listener: (event: unknown) => void): () => void;
  };
  workspace: {
    pickDirectory(): Promise<WorkspacePickResult>;
  };
  shell: {
    quitUi(): Promise<void>;
  };
}

export const PRELOAD_API_ROOT_KEYS = ["connection", "api", "workspace", "shell"] as const;

export function assertNoSecretFields(snapshot: ConnectionSnapshot): void {
  const record = snapshot as unknown as Record<string, unknown>;
  for (const key of ["sessionToken", "token", "authorization", "secret", "absolutePath"]) {
    if (key in record) {
      throw new Error(`Connection snapshot must not include ${key}`);
    }
  }
}
