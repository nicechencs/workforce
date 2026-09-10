import type { ConnectionSnapshot } from "@workforce/ui";

import type { DaemonHealth } from "./types.js";

export type HandshakeResult =
  | { ok: true; protocolVersion: string }
  | {
      ok: false;
      snapshot: Extract<ConnectionSnapshot, { status: "version-mismatch" }>;
    };

export function handshakeProtocolVersion(
  health: DaemonHealth,
  expectedProtocolVersion: string,
): HandshakeResult {
  if (health.protocolVersion === expectedProtocolVersion) {
    return { ok: true, protocolVersion: health.protocolVersion };
  }
  return {
    ok: false,
    snapshot: {
      status: "version-mismatch",
      expectedProtocolVersion,
      actualProtocolVersion: health.protocolVersion,
      recoverable: true,
    },
  };
}
