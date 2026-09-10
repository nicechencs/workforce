import { describe, expect, it } from "vitest";

import { assertNoSecretFields, PRELOAD_API_ROOT_KEYS } from "./bridge.js";

describe("preload contract", () => {
  it("exposes only the four renderer-facing roots", () => {
    expect([...PRELOAD_API_ROOT_KEYS]).toEqual(["connection", "api", "workspace", "shell"]);
  });

  it("rejects snapshots that leak secrets", () => {
    expect(() =>
      assertNoSecretFields({
        status: "online",
        protocolVersion: "0.1",
        mode: "reconnect",
        sessionToken: "secret",
      } as never),
    ).toThrow(/sessionToken/);
  });
});
