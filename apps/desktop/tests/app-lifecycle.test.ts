import { describe, expect, it } from "vitest";

import { desktopUiSingleInstancePolicy } from "../src/main/app-lifecycle/ui-lock.js";
import {
  handleLastWindowClose,
  LAST_WINDOW_CLOSE_POLICY,
} from "../src/main/app-lifecycle/window-policy.js";
import { detachedDaemonSpawnOptions } from "../src/main/daemon-supervisor/spawn.js";
import { decideDaemonUpgrade } from "../src/main/updater/index.js";

describe("app lifecycle", () => {
  it("does not kill the daemon when the last window closes", () => {
    let killed = false;
    const result = handleLastWindowClose({
      kill: () => {
        killed = true;
      },
    });
    expect(killed).toBe(false);
    expect(result.daemonKilled).toBe(false);
    expect(LAST_WINDOW_CLOSE_POLICY.killDaemon).toBe(false);
    expect(LAST_WINDOW_CLOSE_POLICY.taskkillTree).toBe(false);
  });

  it("spawns the daemon detached with ignored stdio", () => {
    const options = detachedDaemonSpawnOptions();
    expect(options.detached).toBe(true);
    expect(options.stdio).toBe("ignore");
    expect(options.windowsHide).toBe(true);
  });

  it("treats the Electron UI lock as separate from the daemon mutex", () => {
    const policy = desktopUiSingleInstancePolicy();
    expect(policy.requestSingleInstanceLock).toBe(true);
    expect(policy.locksDaemon).toBe(false);
  });

  it("refuses daemon binary replacement while a run is active", () => {
    expect(decideDaemonUpgrade({ hasNonTerminalRun: true })).toBe("reject");
    expect(decideDaemonUpgrade({ hasNonTerminalRun: false })).toBe("allow");
  });
});
