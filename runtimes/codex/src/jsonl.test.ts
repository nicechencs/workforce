import { describe, expect, it } from "vitest";

import { RuntimeSdkError } from "@workforce/runtime-sdk";

import { CODEX_RAW_METADATA_MAX_BYTES, CodexJsonlDecoder } from "./jsonl.js";

const NOW = new Date("2026-09-11T00:00:00.000Z");

function decoder(options: ConstructorParameters<typeof CodexJsonlDecoder>[0] = {}) {
  return new CodexJsonlDecoder({ now: () => NOW, ...options });
}

describe("CodexJsonlDecoder", () => {
  it("maps the redacted live host-probe shape and keeps cost unknown", () => {
    const subject = decoder();
    const first = subject.push(
      '{"type":"thread.started","thread_id":"omitted-live-thread-id"}\n' +
        '{"type":"turn.started"}\n' +
        JSON.stringify({
          type: "item.started",
          item: {
            id: "item-1",
            type: "command_execution",
            command: "read the harmless fixture",
            aggregated_output: "",
            exit_code: null,
            status: "in_progress",
          },
        }) +
        "\n" +
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item-1",
            type: "command_execution",
            command: "read the harmless fixture",
            aggregated_output: "SAFE_PROBE_INPUT\n",
            exit_code: 0,
            status: "completed",
          },
        }) +
        "\n" +
        JSON.stringify({
          type: "item.completed",
          item: { id: "item-2", type: "agent_message", text: "SAFE_PROBE_OK" },
        }) +
        "\n" +
        '{"type":"turn.completed","usage":{"input_tokens":12,',
    );
    const second = subject.push(
      '"cached_input_tokens":3,"cache_write_input_tokens":5,"output_tokens":4,"reasoning_output_tokens":2}}\n',
    );

    expect([...first, ...second].map((event) => event.type)).toEqual([
      "runtime.started",
      "runtime.message",
      "runtime.command.started",
      "runtime.command.output",
      "runtime.command.completed",
      "runtime.message",
      "runtime.usage.updated",
      "runtime.completed",
    ]);
    expect(first[2]?.data).toMatchObject({ commandRedacted: true });
    expect(first[3]?.data).toMatchObject({
      contentRedacted: true,
      observedOnCompletedItem: true,
    });
    expect(first[4]?.data).toMatchObject({ exitCode: 0, outputRedacted: true });
    expect(second[0]?.data).toMatchObject({
      usage: {
        inputTokens: 12,
        cachedInputTokens: 3,
        cacheWriteInputTokens: 5,
        outputTokens: 4,
        reasoningOutputTokens: 2,
      },
      monetaryCost: { status: "unknown" },
    });
    expect(second[0]?.data).not.toHaveProperty("costMinor");
    expect(second[1]?.data).toMatchObject({ candidate: true, taskCompletionClaimed: false });
    expect([...first, ...second].map((event) => event.data["adapterSequence"])).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(JSON.stringify([...first, ...second])).not.toContain("SAFE_PROBE_INPUT");
    expect(JSON.stringify([...first, ...second])).not.toContain("SAFE_PROBE_OK");
  });

  it("omits arbitrary text from normalized and raw event data", () => {
    const knownSecret = "fixture-known-secret";
    const subject = decoder();
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
        contentRedacted: true,
        raw: {
          namespace: "openai.codex",
          payload: { redacted: true },
        },
      },
    });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(knownSecret);
    expect(serialized).not.toContain("sk-proj-abcdefghijklmnop");
  });

  it("cannot reconstruct a known secret split across two complete events", () => {
    const firstHalf = "alpha-bravo-";
    const secondHalf = "charlie-delta";
    const events = decoder().push(
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: firstHalf },
      }) +
        "\n" +
        JSON.stringify({
          type: "item.completed",
          item: { type: "command_execution", aggregated_output: secondHalf, exit_code: 0 },
        }) +
        "\n",
    );
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(firstHalf);
    expect(serialized).not.toContain(secondHalf);
    expect(serialized).not.toContain(firstHalf + secondHalf);
  });

  it.each(["ascii", "中文内容", "emoji-🚀-🔒"])(
    "keeps the entire conservative raw envelope within its UTF-8 bound for %s input",
    (text) => {
      const events = decoder().push(
        JSON.stringify({ type: "unknown.future", text: text.repeat(100) }) + "\n",
      );
      const raw = events[0]?.data["raw"];
      expect(Buffer.byteLength(JSON.stringify(raw), "utf8")).toBeLessThanOrEqual(
        CODEX_RAW_METADATA_MAX_BYTES,
      );
      expect(JSON.stringify(raw)).not.toContain(text);
    },
  );

  it("checks an unterminated line immediately for single and accumulated chunks", () => {
    expect(() => decoder({ maxLineBytes: 8 }).push("123456789")).toThrowError(
      /exceeds adapter limit/,
    );

    const accumulated = decoder({ maxLineBytes: 8 });
    expect(() => accumulated.push("1234")).not.toThrow();
    expect(() => accumulated.push("5678")).not.toThrow();
    expect(() => accumulated.push("9")).toThrowError(/exceeds adapter limit/);

    const exactLine = '{"type":"turn.started"}';
    const exact = decoder({ maxLineBytes: Buffer.byteLength(exactLine, "utf8") });
    expect(() => exact.push(exactLine)).not.toThrow();
    expect(exact.push("\n")).toHaveLength(1);
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
