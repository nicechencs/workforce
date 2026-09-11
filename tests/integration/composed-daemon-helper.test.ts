import { describe, expect, it } from "vitest";

import { daemonLockPath } from "../helpers/composed-daemon.js";

describe("composed Daemon test harness", () => {
  it("uses a Windows named pipe instead of a filesystem socket", () => {
    expect(daemonLockPath("t16-events", "win32", "abc123")).toBe(
      `\\\\.\\pipe\\WorkforceTests-t16-events-${process.pid}-abc123`,
    );
  });
});
