import { describe, expect, it } from "vitest";

import {
  formatWin32StartIdentity,
  UNSUPPORTED_CAPTURED_PROCESS_PLATFORMS,
  UNTESTED_CAPTURED_PROCESS_PLATFORMS,
  UNTESTED_PROCESS_PLATFORMS,
} from "./start-identity.js";

describe("formatWin32StartIdentity", () => {
  it("encodes pid and UTC create time as win32:<pid>:<CreateTime>", () => {
    expect(formatWin32StartIdentity(11072, "2026-09-10T10:13:36.1658308Z")).toBe(
      "win32:11072:2026-09-10T10:13:36.1658308Z",
    );
  });

  it("pads JavaScript Date milliseconds to .NET round-trip width", () => {
    expect(formatWin32StartIdentity(1, new Date("2026-09-10T10:13:36.165Z"))).toBe(
      "win32:1:2026-09-10T10:13:36.1650000Z",
    );
  });
});

describe("UNTESTED_PROCESS_PLATFORMS", () => {
  it("documents macOS as untested", () => {
    expect(UNTESTED_PROCESS_PLATFORMS).toEqual(["darwin"]);
  });
});

describe("UNTESTED_CAPTURED_PROCESS_PLATFORMS", () => {
  it("documents macOS as untested for captured processes", () => {
    expect(UNTESTED_CAPTURED_PROCESS_PLATFORMS).toEqual(["darwin"]);
  });
});

describe("UNSUPPORTED_CAPTURED_PROCESS_PLATFORMS", () => {
  it("documents Windows captured processes as fail-closed unsupported", () => {
    expect(UNSUPPORTED_CAPTURED_PROCESS_PLATFORMS).toEqual(["win32"]);
  });
});
