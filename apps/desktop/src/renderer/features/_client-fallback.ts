import {
  createDesktopClient,
  DesktopClient,
  type ClientTransport,
  type CommandOptions,
  type ListQuery,
  type PageDto,
  type TransportRequest,
  type TransportResponse,
} from "@workforce/desktop-client";
import type { ConnectionSnapshot, WorkforcePreloadApi } from "@workforce/ui";

type WorkforceGlobals = {
  workforce?: WorkforcePreloadApi;
};

let injectedClient: DesktopClient | undefined;
let injectedConnection: ConnectionSnapshot | undefined;
let cachedClient: DesktopClient | undefined;

export function getPreloadApi(): WorkforcePreloadApi | undefined {
  return (globalThis as WorkforceGlobals).workforce;
}

export function setWorkforceClientForTests(client: DesktopClient | null): void {
  injectedClient = client ?? undefined;
  cachedClient = undefined;
}

export function setWorkforceConnectionForTests(snapshot: ConnectionSnapshot | undefined): void {
  injectedConnection = snapshot;
}

export function getInjectedConnectionForTests(): ConnectionSnapshot | undefined {
  return injectedConnection;
}

export function createPreloadTransport(api: WorkforcePreloadApi): ClientTransport {
  return {
    async request(req: TransportRequest): Promise<TransportResponse> {
      const input: {
        method: TransportRequest["method"];
        path: string;
        headers?: Record<string, string>;
        body?: unknown;
      } = { method: req.method, path: req.path };
      if (req.headers !== undefined) {
        input.headers = req.headers;
      }
      if (req.body !== undefined) {
        input.body = req.body;
      }
      const res = await api.api.request(input);
      if (res.ok) {
        return { status: res.status, headers: {}, body: res.body };
      }
      return {
        status: res.status,
        headers: {},
        body: {
          type: `urn:workforce:error:${res.code}`,
          title: res.message,
          status: res.status,
          code: res.code,
          detail: res.message,
          instance: req.path,
          requestId: "",
          retryable: res.status >= 500,
        },
      };
    },
  };
}

function unavailableTransport(): ClientTransport {
  return {
    async request(req: TransportRequest): Promise<TransportResponse> {
      return {
        status: 503,
        headers: {},
        body: {
          type: "urn:workforce:error:offline",
          title: "本地 Daemon 未连接",
          status: 503,
          code: "offline",
          detail: "本地 Daemon 未连接",
          instance: req.path,
          requestId: "",
          retryable: true,
        },
      };
    },
  };
}

export function getWorkforceClient(): DesktopClient {
  if (injectedClient !== undefined) {
    return injectedClient;
  }
  if (cachedClient !== undefined) {
    return cachedClient;
  }
  const api = getPreloadApi();
  cachedClient = createDesktopClient({
    transport: api ? createPreloadTransport(api) : unavailableTransport(),
  });
  return cachedClient;
}

export type CatalogClient = {
  listTeams?: (query?: ListQuery) => Promise<PageDto<unknown>>;
  getTeam?: (id: string) => Promise<unknown>;
  listWorkflows?: (query?: ListQuery) => Promise<PageDto<unknown>>;
  getWorkflow?: (id: string) => Promise<unknown>;
  listRuntimes?: () => Promise<PageDto<unknown>>;
  listNodes?: () => Promise<PageDto<unknown>>;
  getProjectBudget?: (id: string) => Promise<unknown>;
  createProjectWorkspace?: (
    projectId: string,
    input: { authorizationRef: string },
    options: CommandOptions,
  ) => Promise<unknown>;
};

export function asCatalogClient(client: DesktopClient): CatalogClient {
  return client as unknown as CatalogClient;
}

export function hasCatalogMethod<K extends keyof CatalogClient>(
  client: CatalogClient,
  name: K,
): client is CatalogClient & Required<Pick<CatalogClient, K>> {
  return typeof client[name] === "function";
}
