import {
  createDesktopClient,
  type ClientTransport,
  type DesktopClient,
} from "@workforce/desktop-client";
import type { ConnectionSnapshot, WorkforcePreloadApi } from "@workforce/ui";

import { createIpcTransport, type IpcApiRequestFn } from "./ipc-transport.js";

type WorkforceGlobals = {
  workforce?: WorkforcePreloadApi;
  window?: { workforce?: WorkforcePreloadApi };
};

let injectedClient: DesktopClient | undefined;
let injectedRequest: IpcApiRequestFn | undefined;
let injectedConnection: ConnectionSnapshot | undefined;
let cachedClient: DesktopClient | undefined;

export function getPreloadApi(): WorkforcePreloadApi | undefined {
  const globals = globalThis as WorkforceGlobals;
  return globals.workforce ?? globals.window?.workforce;
}

export function createPreloadTransport(api: WorkforcePreloadApi): ClientTransport {
  return createIpcTransport((input) => api.api.request(input));
}

function unavailableTransport(): ClientTransport {
  return createIpcTransport(async () => ({
    ok: false,
    status: 503,
    code: "offline",
    message: "本地 Daemon 未连接",
  }));
}

function liveTransport(): ClientTransport {
  return {
    async request(req) {
      if (injectedRequest !== undefined) {
        return createIpcTransport(injectedRequest).request(req);
      }
      const api = getPreloadApi();
      if (api) {
        return createPreloadTransport(api).request(req);
      }
      return unavailableTransport().request(req);
    },
  };
}

/** 唯一生产 DesktopClient：shell、hooks、T13 页面与测试注入共用。 */
export function getWorkforceClient(): DesktopClient {
  if (injectedClient !== undefined) {
    return injectedClient;
  }
  if (cachedClient === undefined) {
    cachedClient = createDesktopClient({ transport: liveTransport() });
  }
  return cachedClient;
}

export function setWorkforceClientForTests(client: DesktopClient | null): void {
  injectedClient = client ?? undefined;
  cachedClient = undefined;
}

export function setApiRequestForTests(request: IpcApiRequestFn | null): void {
  injectedRequest = request ?? undefined;
  injectedClient = undefined;
  cachedClient = undefined;
}

export function resetRendererClient(): void {
  injectedClient = undefined;
  injectedRequest = undefined;
  cachedClient = undefined;
}

export function setWorkforceConnectionForTests(snapshot: ConnectionSnapshot | undefined): void {
  injectedConnection = snapshot;
}

export function getInjectedConnectionForTests(): ConnectionSnapshot | undefined {
  return injectedConnection;
}
