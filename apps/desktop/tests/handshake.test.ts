import { describe, expect, it } from "vitest";

import { handshakeProtocolVersion } from "../src/main/daemon-supervisor/handshake.js";

describe("protocol handshake", () => {
  it("returns a recoverable error when versions differ", () => {
    const result = handshakeProtocolVersion(
      {
        ok: true,
        pid: 1,
        port: 9,
        startIdentity: "1:x:y",
        protocolVersion: "0.0",
      },
      "0.1",
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.snapshot.status).toBe("version-mismatch");
    expect(result.snapshot.recoverable).toBe(true);
  });

  it("accepts an exact protocolVersion match", () => {
    const result = handshakeProtocolVersion(
      {
        ok: true,
        pid: 1,
        port: 9,
        startIdentity: "1:x:y",
        protocolVersion: "0.1",
      },
      "0.1",
    );
    expect(result).toEqual({ ok: true, protocolVersion: "0.1" });
  });
});
