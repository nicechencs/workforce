import path from "node:path";

import { describe, expect, it } from "vitest";

import { electronSmokeEnv, resolveTscCommand } from "../scripts/smoke.mjs";

describe("desktop smoke script", () => {
  const root = path.resolve("C:/workforce/apps/desktop");

  it("uses Node to launch the TypeScript CLI on Windows without a shell shim", () => {
    const command = resolveTscCommand(root, "win32");
    expect(command.command).toBe(process.execPath);
    expect(command.args).toEqual([
      expect.stringMatching(/typescript[\\/]bin[\\/]tsc/),
      "-p",
      "tsconfig.json",
    ]);
  });

  it.each(["linux", "darwin", "freebsd"])("keeps the POSIX tsc bin on %s", (platform) => {
    expect(resolveTscCommand(root, platform)).toEqual({
      command: path.join(root, "node_modules/.bin/tsc"),
      args: ["-p", "tsconfig.json"],
    });
  });

  it("does not pass any casing of ELECTRON_RUN_AS_NODE to the smoke Electron process", () => {
    const env = electronSmokeEnv(
      {
        PATH: "test",
        ELECTRON_RUN_AS_NODE: "1",
        electron_run_as_node: "1",
        Electron_Run_As_Node: "1",
      },
      {
        url: "http://127.0.0.1:1234",
        stateDir: "state",
        workspaceDir: "workspace",
        resultPath: "result",
      },
    );
    expect(Object.keys(env).map((key) => key.toUpperCase())).not.toContain("ELECTRON_RUN_AS_NODE");
    expect(env).toMatchObject({
      PATH: "test",
      ELECTRON_RENDERER_URL: "http://127.0.0.1:1234",
      WORKFORCE_DESKTOP_SMOKE: "1",
    });
  });
});
