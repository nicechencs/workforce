import { describe, expect, it } from "vitest";

import { renderShell } from "../src/renderer/app/shell.js";
import { connectionBanner, shellNav } from "../src/renderer/components/index.js";

describe("renderer shell", () => {
  it("shows loading overlay and disabled nav while connecting", () => {
    const view = renderShell({ connection: { status: "loading" }, currentPath: "/" });
    expect(view.overlay).toBe("loading");
    expect(view.banner?.id).toBe("loading");
    expect(view.mainEnabled).toBe(false);
    expect(shellNav({ status: "loading" }, "/").every((item) => !item.enabled)).toBe(true);
  });

  it("shows a recoverable offline banner", () => {
    const banner = connectionBanner({ status: "offline" });
    expect(banner?.id).toBe("offline");
    expect(banner?.recoverable).toBe(true);
  });

  it("keeps version mismatch recoverable and blocks feature navigation", () => {
    const view = renderShell({
      connection: {
        status: "version-mismatch",
        expectedProtocolVersion: "0.1",
        actualProtocolVersion: "9.9",
        recoverable: true,
      },
      currentPath: "/projects",
    });
    expect(view.mainEnabled).toBe(false);
    expect(view.banner?.id).toBe("version-mismatch");
  });
});
