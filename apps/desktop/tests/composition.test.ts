import path from "node:path";

import { describe, expect, it } from "vitest";

import { IPC_INVOKE_CHANNELS } from "../src/preload/contracts.js";
import {
  applyLastWindowClose,
  applyUiSingleInstancePolicy,
  attachIpcHandlers,
  resolveRendererLoadTarget,
} from "../src/main/composition.js";
import { EventSubscriptionHub } from "../src/main/ipc/subscriptions.js";
import { WorkspaceGrantStore } from "../src/main/ipc/workspace-picker.js";
import { LAST_WINDOW_CLOSE_POLICY } from "../src/main/app-lifecycle/window-policy.js";

function ipcDeps() {
  return {
    getConnection: async () => ({ status: "loading" as const }),
    reconnect: async () => ({ status: "offline" as const }),
    requestApi: async () => ({ ok: true as const, status: 200, body: {} }),
    dialog: { pick: async () => null },
    grants: new WorkspaceGrantStore(),
    subscriptions: new EventSubscriptionHub(),
    quitUi: async () => undefined,
  };
}

describe("desktop composition", () => {
  it("does not kill the daemon when the last window closes", () => {
    let killed = false;
    let quit = false;
    const result = applyLastWindowClose({
      quitUi: () => {
        quit = true;
      },
      daemon: {
        kill: () => {
          killed = true;
        },
      },
    });
    expect(killed).toBe(false);
    expect(quit).toBe(true);
    expect(result.killDaemon).toBe(false);
    expect(LAST_WINDOW_CLOSE_POLICY.killDaemon).toBe(false);
  });

  it("loads the Vite URL in development and the built index.html in production", () => {
    expect(
      resolveRendererLoadTarget({ ELECTRON_RENDERER_URL: "http://127.0.0.1:5173/" }, "/app"),
    ).toEqual({ kind: "url", target: "http://127.0.0.1:5173/" });
    expect(resolveRendererLoadTarget({}, "/app")).toEqual({
      kind: "file",
      target: path.join("/app", "dist/renderer/index.html"),
    });
  });

  it("maps whitelist IPC channels onto ipcMain.handle", async () => {
    const handled = new Map<string, (payload: unknown) => Promise<unknown>>();
    const channels = attachIpcHandlers((channel, listener) => {
      handled.set(channel, listener);
    }, ipcDeps());
    expect(channels.sort()).toEqual(Object.values(IPC_INVOKE_CHANNELS).slice().sort());
    const getConnection = handled.get(IPC_INVOKE_CHANNELS.connectionGet);
    expect(await getConnection?.(undefined)).toEqual({ status: "loading" });
  });

  it("quits a second UI instance without locking the daemon", () => {
    let quit = false;
    const result = applyUiSingleInstancePolicy({
      requestLock: () => false,
      quit: () => {
        quit = true;
      },
    });
    expect(result.isPrimary).toBe(false);
    expect(quit).toBe(true);
  });
});
