import { describe, expect, it } from "vitest";

import { CredentialBrokerError, InMemoryCredentialBroker } from "./credentials.js";
import { createCanonicalAction } from "./digest.js";
import { InMemoryPolicyEngine } from "./engine.js";

function sampleRef() {
  return {
    id: "crd_openai",
    provider: "openai",
    displayName: "Codex API key",
    scopes: ["codex.exec"],
    status: "active" as const,
    rotationId: "rot_1",
  };
}

describe("InMemoryCredentialBroker", () => {
  it("injects a single env key and never a copy of process.env", async () => {
    const broker = new InMemoryCredentialBroker();
    await broker.register(sampleRef(), "sk-test_only_for_broker");
    const meta = await broker.getRef("crd_openai");
    expect(meta).toEqual(sampleRef());
    expect(JSON.stringify(meta)).not.toContain("sk-test_only_for_broker");

    const injection = await broker.inject({
      credentialRefId: "crd_openai",
      mode: "env_key",
      envKey: "OPENAI_API_KEY",
    });
    expect(injection.extraEnv).toEqual({ key: "OPENAI_API_KEY", value: "sk-test_only_for_broker" });
    const overlay = broker.materializeOverlay(injection);
    expect(Object.keys(overlay)).toEqual(["OPENAI_API_KEY"]);
    expect(Object.keys(overlay).length).toBeLessThan(Object.keys(process.env).length);
    expect(overlay).not.toMatchObject(process.env);
  });

  it("supports stdin injection for API-key mode without copying auth.json", async () => {
    const broker = new InMemoryCredentialBroker();
    await broker.register(sampleRef(), "sk-stdin-key");
    const injection = await broker.inject({ credentialRefId: "crd_openai", mode: "stdin" });
    expect(injection).toEqual({
      credentialRefId: "crd_openai",
      mode: "stdin",
      stdinSecret: "sk-stdin-key",
    });
    expect(broker.materializeOverlay(injection)).toEqual({});
  });

  it("refuses to copy the user environment or auth.json", async () => {
    const broker = new InMemoryCredentialBroker();
    expect(() => broker.requestCopyUserEnv()).toThrow(CredentialBrokerError);
    expect(() => broker.requestCopyAuthJson()).toThrow(/auth\.json/);
    try {
      broker.requestCopyUserEnv();
    } catch (error) {
      expect(error).toBeInstanceOf(CredentialBrokerError);
      if (error instanceof CredentialBrokerError) {
        expect(error.code).toBe("forbidden_copy");
      }
    }
  });

  it("policy denies credential copy actions even if a grant is recorded", async () => {
    const engine = new InMemoryPolicyEngine({ principalId: "usr_alice" });
    const action = createCanonicalAction({ type: "credential.copy_env", resource: "env" });
    await engine.recordGrant({
      action,
      gate: "action",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    await expect(engine.decide(action)).resolves.toMatchObject({ decision: "deny" });
  });
});
