import { describe, expect, it } from "vitest";

import { bannerForConnection, overlayForConnection } from "./banners.js";

describe("bannerForConnection", () => {
  it("shows a loading overlay while discovering the daemon", () => {
    expect(overlayForConnection({ status: "loading" })).toBe("loading");
    expect(bannerForConnection({ status: "loading" })?.id).toBe("loading");
  });

  it("shows a recoverable offline banner", () => {
    const banner = bannerForConnection({ status: "offline" });
    expect(banner?.id).toBe("offline");
    expect(banner?.recoverable).toBe(true);
    expect(banner?.action?.id).toBe("retry");
  });

  it("shows a recoverable version mismatch without implying a second daemon", () => {
    const banner = bannerForConnection({
      status: "version-mismatch",
      expectedProtocolVersion: "0.1",
      actualProtocolVersion: "0.0",
      recoverable: true,
    });
    expect(banner?.id).toBe("version-mismatch");
    expect(banner?.recoverable).toBe(true);
    expect(banner?.message).toContain("0.1");
    expect(banner?.message).toContain("第二个 Daemon");
  });

  it("hides banners while online", () => {
    expect(
      bannerForConnection({ status: "online", protocolVersion: "0.1", mode: "reconnect" }),
    ).toBeNull();
    expect(
      overlayForConnection({ status: "online", protocolVersion: "0.1", mode: "reconnect" }),
    ).toBeNull();
  });
});
