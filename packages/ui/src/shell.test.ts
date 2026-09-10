import { describe, expect, it } from "vitest";

import { buildShellView } from "./shell.js";

describe("buildShellView", () => {
  it("disables primary navigation until the daemon is online", () => {
    const view = buildShellView({ connection: { status: "loading" }, currentPath: "/" });
    expect(view.mainEnabled).toBe(false);
    expect(view.nav.every((item) => item.enabled === false)).toBe(true);
    expect(view.overlay).toBe("loading");
  });

  it("enables P0 navigation when connected", () => {
    const view = buildShellView({
      connection: { status: "online", protocolVersion: "0.1", mode: "spawn" },
      currentPath: "/projects",
    });
    expect(view.mainEnabled).toBe(true);
    expect(view.nav.map((item) => item.id)).toEqual([
      "dashboard",
      "projects",
      "teams",
      "nodes",
      "approvals",
      "settings",
    ]);
    expect(view.nav.find((item) => item.id === "projects")?.current).toBe(true);
  });
});
