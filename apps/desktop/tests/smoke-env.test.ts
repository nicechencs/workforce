import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isSmokeResultOk, serializeDesktopMainPathSmoke } from "../src/main/smoke-driver.js";
import {
  isDesktopSmokeEnabled,
  isDesktopSmokeHeaded,
  resolveDaemonLaunchArgs,
  resolveSmokeDirectoryOverride,
  resolveSmokeResultPath,
  resolveSmokeWorkspacePath,
  sourceDaemonNodeRequirement,
  supportsSourceDaemonNode,
  shouldLaunchElectronHeadless,
} from "../src/main/smoke-env.js";
import { createMainWindowSpec } from "../src/main/windows/factory.js";

describe("desktop smoke env", () => {
  it("stays off for default pnpm test and requires an explicit opt-in", () => {
    expect(isDesktopSmokeEnabled({})).toBe(false);
    expect(isDesktopSmokeEnabled({ WORKFORCE_DESKTOP_SMOKE: "1" })).toBe(true);
    expect(isDesktopSmokeHeaded({ WORKFORCE_DESKTOP_SMOKE_HEADED: "1" })).toBe(true);
    expect(shouldLaunchElectronHeadless({ WORKFORCE_DESKTOP_SMOKE: "1" })).toBe(true);
    expect(
      shouldLaunchElectronHeadless({
        WORKFORCE_DESKTOP_SMOKE: "1",
        WORKFORCE_DESKTOP_SMOKE_HEADED: "1",
      }),
    ).toBe(false);
  });

  it("does not skip the directory dialog unless Electron smoke is explicitly enabled", () => {
    const workspace = path.join(os.tmpdir(), "wf-smoke-ws");
    expect(
      resolveSmokeDirectoryOverride({
        WORKFORCE_SMOKE_WORKSPACE: workspace,
      }),
    ).toBeNull();
    expect(
      resolveSmokeDirectoryOverride({
        WORKFORCE_DESKTOP_SMOKE: "1",
        WORKFORCE_SMOKE_WORKSPACE: workspace,
      }),
    ).toBe(path.resolve(workspace));
    expect(resolveSmokeWorkspacePath({ WORKFORCE_SMOKE_WORKSPACE: workspace })).toBe(
      path.resolve(workspace),
    );
    expect(resolveSmokeResultPath({ WORKFORCE_DESKTOP_SMOKE_OUT: "out.json" })).toBe(
      path.resolve("out.json"),
    );
  });

  it("adds type transformation when the supervisor launches the TypeScript daemon entry", () => {
    const tsArgs = resolveDaemonLaunchArgs("/app/daemon/src/index.ts", "/tmp/state");
    expect(tsArgs[0]).toBe("--experimental-transform-types");
    expect(tsArgs).toContain("/app/daemon/src/index.ts");
    expect(resolveDaemonLaunchArgs("/app/daemon/dist/index.js", "/tmp/state")[0]).toBe(
      "/app/daemon/dist/index.js",
    );
  });

  it("requires a Node runtime that supports source type transformation", () => {
    expect(supportsSourceDaemonNode("22.7.0")).toBe(true);
    expect(supportsSourceDaemonNode("22.6.9")).toBe(false);
    expect(supportsSourceDaemonNode("v24.0.0")).toBe(true);
    expect(supportsSourceDaemonNode("not-a-version")).toBe(false);
    expect(sourceDaemonNodeRequirement("22.6.9")).toBe(
      "Daemon source entry requires Node >= 22.7; current Node is 22.6.9.",
    );
    expect(sourceDaemonNodeRequirement("24.0.0")).toBeNull();
  });

  it("prefixes --import so workspace TypeScript packages resolve .js to .ts", () => {
    const args = resolveDaemonLaunchArgs("/app/daemon/src/index.ts", "/tmp/state", {
      importModule: "file:///loader.mjs",
    });
    expect(args.slice(0, 4)).toEqual([
      "--import",
      "file:///loader.mjs",
      "--experimental-transform-types",
      "/app/daemon/src/index.ts",
    ]);
  });

  it("hides the BrowserWindow during the default headless smoke", () => {
    expect(createMainWindowSpec("preload.js", { show: false }).show).toBe(false);
    expect(createMainWindowSpec("preload.js").show).toBe(true);
  });

  it("serializes a self-contained in-page driver with stable test ids", () => {
    const source = serializeDesktopMainPathSmoke();
    expect(source).toContain("project-create");
    expect(source).toContain("project-tab-settings");
    expect(source).toContain("project-bind-workspace");
    expect(source).toContain("project-tab-tasks");
    expect(source).toContain("project-action-startPlanning");
    expect(source).toContain("project-action-confirmPlan");
    expect(source).toContain("project-action-startProject");
    expect(isSmokeResultOk({ ok: true, status: "执行中", tasks: ["dev_alpha"] })).toBe(true);
    expect(isSmokeResultOk({ ok: true, status: "执行中", tasks: [] })).toBe(false);
  });
});
