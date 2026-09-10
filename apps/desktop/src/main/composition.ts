import path from "node:path";

import type { ApiRequest, ApiResponse } from "@workforce/ui";

import { handleLastWindowClose, type DaemonKillHandle } from "./app-lifecycle/window-policy.js";
import { desktopUiSingleInstancePolicy } from "./app-lifecycle/ui-lock.js";
import { IPC_INVOKE_CHANNELS, IPC_PUSH_CHANNELS } from "../preload/contracts.js";
import { dispatchIpc, type IpcRouterDeps } from "./ipc/router.js";
import { proxyApiRequest, type SessionSecrets } from "./ipc/rest-proxy.js";
import type { BrowserWindowSpec } from "./windows/factory.js";

export interface RendererLoadTarget {
  kind: "url" | "file";
  target: string;
}

export function resolveRendererLoadTarget(
  env: Record<string, string | undefined>,
  appRoot: string,
): RendererLoadTarget {
  const url = env.ELECTRON_RENDERER_URL ?? env.VITE_DEV_SERVER_URL;
  if (typeof url === "string" && url.length > 0) {
    return { kind: "url", target: url };
  }
  return { kind: "file", target: path.join(appRoot, "dist/renderer/index.html") };
}

export function resolvePreloadPath(appRoot: string): string {
  return path.join(appRoot, "dist/preload/electron-entry.cjs");
}

export function applyUiSingleInstancePolicy(input: {
  requestLock: () => boolean;
  quit: () => void;
}): { isPrimary: boolean } {
  const policy = desktopUiSingleInstancePolicy();
  if (!policy.requestSingleInstanceLock) {
    return { isPrimary: true };
  }
  const isPrimary = input.requestLock();
  if (!isPrimary) {
    input.quit();
  }
  return { isPrimary };
}

export function applyLastWindowClose(input: {
  quitUi: () => void;
  daemon: DaemonKillHandle | null;
}): { killDaemon: false; quitUi: true } {
  const result = handleLastWindowClose(input.daemon);
  if (result.quitUi) {
    input.quitUi();
  }
  return { killDaemon: false, quitUi: true };
}

export function focusExistingWindow(win: {
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
}): void {
  if (win.isMinimized()) {
    win.restore();
  }
  win.focus();
}

export function attachIpcHandlers(
  handle: (channel: string, listener: (payload: unknown) => Promise<unknown>) => void,
  deps: IpcRouterDeps,
): string[] {
  const channels = Object.values(IPC_INVOKE_CHANNELS);
  for (const channel of channels) {
    handle(channel, (payload) => dispatchIpc(channel, payload, deps));
  }
  return channels;
}

export function ipcPushChannels(): { connectionChanged: string; event: string } {
  return {
    connectionChanged: IPC_PUSH_CHANNELS.connectionChanged,
    event: IPC_PUSH_CHANNELS.event,
  };
}

export async function proxyConnectedApiRequest(
  input: ApiRequest,
  target: { port: number; session: SessionSecrets | null } | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResponse> {
  if (!target) {
    return {
      ok: false,
      status: 503,
      code: "offline",
      message: "Daemon is not connected",
    };
  }
  return proxyApiRequest(input, { port: target.port }, target.session, fetchImpl);
}

export function windowSpecWithPreload(
  createSpec: (preloadPath: string) => BrowserWindowSpec,
  preloadPath: string,
): BrowserWindowSpec {
  return createSpec(preloadPath);
}
