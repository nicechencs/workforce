import { describe, expect, it } from "vitest";

import { createPreloadApi } from "../src/preload/bridge.js";
import {
  assertAllowedIpcInvokeChannel,
  IPC_INVOKE_CHANNELS,
  IpcAccessDeniedError,
  PRELOAD_WORLD_KEY,
} from "../src/preload/contracts.js";

describe("typed preload", () => {
  it("only invokes whitelisted channels and never exposes raw ipc", async () => {
    const invoked: string[] = [];
    const api = createPreloadApi({
      invoke: async (channel) => {
        invoked.push(channel);
        return { status: "loading" };
      },
      on: () => () => undefined,
    });
    expect(Object.keys(api).sort()).toEqual(["api", "connection", "shell", "workspace"]);
    expect("invoke" in api).toBe(false);
    await api.connection.getState();
    expect(invoked).toEqual([IPC_INVOKE_CHANNELS.connectionGet]);
  });

  it("uses the isolated world key workforce", () => {
    expect(PRELOAD_WORLD_KEY).toBe("workforce");
  });

  it("denies arbitrary invoke channels", () => {
    expect(() => assertAllowedIpcInvokeChannel("fs.readFile")).toThrow(IpcAccessDeniedError);
    expect(() => assertAllowedIpcInvokeChannel("child_process.exec")).toThrow(IpcAccessDeniedError);
    expect(assertAllowedIpcInvokeChannel(IPC_INVOKE_CHANNELS.connectionGet)).toBe(
      IPC_INVOKE_CHANNELS.connectionGet,
    );
  });
});
