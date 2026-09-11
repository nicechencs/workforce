import { describe, expect, it } from "vitest";

import { REDACTED, SecretRedactor } from "@workforce/observability";
import { RuntimeSdkError } from "@workforce/runtime-sdk";

import { CodexJsonlDecoder } from "./jsonl.js";

const NOW = new Date("2026-09-11T00:00:00.000Z");

function decoder(options: ConstructorParameters<typeof CodexJsonlDecoder>[0] = {}) {
  return new CodexJsonlDecoder({ now: () => NOW, ...options });
}

describe("CodexJsonlDecoder", () => {
  it("incrementally maps the documented JSONL lifecycle and keeps cost unknown", () => {
    const subject = decoder();
    const first = subject.push(
      '{"type":"thread.started","thread_id":"thread-safe"}\n' +
        '{"type":"turn.completed","usage":{"input_tokens":12,',
    );
    const second = subject.push(
      '"cached_input_tokens":3,"output_tokens":4,"reasoning_output_tokens":2}}\n',
    );

    expect([...first, ...second].map((event) => event.type)).toEqual([
      "runtime.started",
      "runtime.usage.updated",
      "runtime.completed",
    ]);
    expect(second[0]?.data).toMatchObject({
      usage: {
        inputTokens: 12,
        cachedInputTokens: 3,
        outputTokens: 4,
        reasoningOutputTokens: 2,
      },
      monetaryCost: { status: "unknown" },
    });
    expect(second[0]?.data).not.toHaveProperty("costMinor");
    expect(second[1]?.data).toMatchObject({ candidate: true, taskCompletionClaimed: false });
    expect([...first, ...second].map((event) => event.data["adapterSequence"])).toEqual([1, 2, 3]);
  });

  it("maps command and assistant items without leaking secrets in normalized or raw data", () => {
    const knownSecret = "fixture-known-secret";
    const subject = decoder({ redactor: new SecretRedactor({ knownSecrets: [knownSecret] }) });
    const events = subject.push(
      JSON.stringify({
        type: "item.completed",
        api_key: "sk-proj-abcdefghijklmnop",
        item: {
          id: "item-1",
          type: "agent_message",
          text: `done ${knownSecret}`,
        },
      }) + "\n",
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "runtime.message",
      sourceCursor: "codex-jsonl:1:1",
      data: {
        content: `done ${REDACTED}`,
        raw: { namespace: "openai.codex" },
      },
    });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(knownSecret);
    expect(serialized).not.toContain("sk-proj-abcdefghijklmnop");
  });

  it("bounds namespaced raw payloads", () => {
    const events = decoder({ maxRawBytes: 40 }).push(
      JSON.stringify({ type: "unknown.future", text: "x".repeat(200) }) + "\n",
    );
    expect(events[0]?.data).toMatchObject({
      raw: {
        namespace: "openai.codex",
        payload: { truncated: true },
      },
    });
  });

  it("rejects malformed and oversized JSONL without echoing source text", () => {
    const malformed = decoder();
    malformed.push('{"token":"secret"');
    expect(() => malformed.flush()).toThrowError(
      expect.objectContaining<Partial<RuntimeSdkError>>({
        code: "validation_failed",
        message: "Codex emitted invalid JSONL",
      }),
    );

    const oversized = decoder({ maxLineBytes: 8 });
    expect(() => oversized.push('{"type":"turn.started"}\n')).toThrowError(/exceeds adapter limit/);
  });
});
