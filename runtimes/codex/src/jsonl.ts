import type { RuntimeEvent } from "@workforce/runtime-spi";
import { RuntimeSdkError } from "@workforce/runtime-sdk";

const DEFAULT_MAX_LINE_BYTES = 256 * 1024;

/** Maximum UTF-8 bytes of the entire fixed `data.raw` metadata envelope. */
export const CODEX_RAW_METADATA_MAX_BYTES = 256;

type JsonObject = Record<string, unknown>;

export interface CodexJsonlDecoderOptions {
  now?: () => Date;
  maxLineBytes?: number;
}

type TranslatedEvent = { type: string; data: Record<string, unknown> };

/**
 * Incrementally decodes Codex JSONL. Its cursor is only an in-memory source
 * position for dedupe; it is not resumable after the process/adapter restarts.
 */
export class CodexJsonlDecoder {
  private readonly now: () => Date;
  private readonly maxLineBytes: number;
  private buffer = "";
  private sourceLine = 0;
  private adapterSequence = 0;

  constructor(options: CodexJsonlDecoderOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    if (!Number.isInteger(this.maxLineBytes) || this.maxLineBytes < 1) {
      throw new Error("maxLineBytes must be a positive integer");
    }
  }

  push(chunk: string): RuntimeEvent[] {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    this.assertLineSize(this.buffer, this.sourceLine + lines.length + 1);
    return lines.flatMap((line) => this.decodeLine(line));
  }

  flush(): RuntimeEvent[] {
    if (this.buffer.length === 0) {
      return [];
    }
    const line = this.buffer;
    this.buffer = "";
    return this.decodeLine(line);
  }

  private decodeLine(lineWithCarriageReturn: string): RuntimeEvent[] {
    const line = lineWithCarriageReturn.endsWith("\r")
      ? lineWithCarriageReturn.slice(0, -1)
      : lineWithCarriageReturn;
    this.sourceLine += 1;
    if (line.trim().length === 0) {
      return [];
    }
    this.assertLineSize(line, this.sourceLine);

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new RuntimeSdkError("validation_failed", "Codex emitted invalid JSONL", {
        details: { sourceLine: this.sourceLine },
      });
    }
    if (!isObject(parsed)) {
      throw new RuntimeSdkError("validation_failed", "Codex JSONL event must be an object", {
        details: { sourceLine: this.sourceLine },
      });
    }

    const translated = translateCodexEvent(parsed);
    const raw = conservativeRawMetadata();
    const time = this.now().toISOString();
    return translated.map((event, index) => {
      this.adapterSequence += 1;
      return {
        type: event.type,
        time,
        sourceCursor: `codex-jsonl:${this.sourceLine}:${index + 1}`,
        data: {
          ...event.data,
          adapterSequence: this.adapterSequence,
          raw,
        },
      };
    });
  }

  private assertLineSize(line: string, sourceLine: number): void {
    const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
    const bytes = Buffer.byteLength(normalized, "utf8");
    if (bytes > this.maxLineBytes) {
      throw new RuntimeSdkError("validation_failed", "Codex JSONL line exceeds adapter limit", {
        details: { sourceLine, bytes, maxLineBytes: this.maxLineBytes },
      });
    }
  }
}

function translateCodexEvent(event: JsonObject): TranslatedEvent[] {
  const sourceType = stringValue(event["type"]) ?? "unknown";
  switch (sourceType) {
    case "thread.started":
      return [{ type: "runtime.started", data: {} }];
    case "turn.started":
      return [{ type: "runtime.message", data: { kind: "turn_started" } }];
    case "turn.completed": {
      const usage = usageData(event["usage"]);
      return [
        {
          type: "runtime.usage.updated",
          data: {
            usage,
            monetaryCost: { status: "unknown" },
          },
        },
        {
          type: "runtime.completed",
          data: { candidate: true, taskCompletionClaimed: false },
        },
      ];
    }
    case "turn.failed":
      return [
        {
          type: "runtime.failed",
          data: { reason: "codex_turn_failed", contentRedacted: true },
        },
      ];
    case "error":
      return [
        {
          type: "runtime.message",
          data: {
            level: "error",
            contentRedacted: true,
          },
        },
      ];
    case "item.started":
    case "item.updated":
    case "item.completed":
      return translateItem(sourceType, event["item"]);
    default:
      return [
        {
          type: "runtime.message",
          data: { kind: "codex_event", sourceType: "unrecognized" },
        },
      ];
  }
}

function translateItem(
  sourceType: "item.started" | "item.updated" | "item.completed",
  value: unknown,
): TranslatedEvent[] {
  if (!isObject(value)) {
    return [{ type: "runtime.message", data: { kind: sourceType, malformedItem: true } }];
  }
  const itemType = stringValue(value["type"]) ?? "unknown";
  if (itemType === "command_execution") {
    if (sourceType === "item.started") {
      return [
        {
          type: "runtime.command.started",
          data: { commandRedacted: typeof value["command"] === "string" },
        },
      ];
    }
    if (sourceType === "item.updated") {
      return [
        {
          type: "runtime.command.output",
          data: { contentRedacted: true },
        },
      ];
    }
    const completed: TranslatedEvent[] = [];
    if (typeof value["aggregated_output"] === "string" && value["aggregated_output"].length > 0) {
      completed.push({
        type: "runtime.command.output",
        data: { contentRedacted: true, observedOnCompletedItem: true },
      });
    }
    completed.push({
      type: "runtime.command.completed",
      data: {
        ...optionalInteger("exitCode", value["exit_code"]),
        outputRedacted: typeof value["aggregated_output"] === "string",
      },
    });
    return completed;
  }
  if (itemType === "agent_message" && sourceType === "item.completed") {
    return [
      {
        type: "runtime.message",
        data: {
          role: "assistant",
          contentRedacted: true,
        },
      },
    ];
  }
  if (itemType === "file_change" && sourceType === "item.completed") {
    return [{ type: "runtime.file.changed", data: { pathsRedacted: true } }];
  }
  return [
    {
      type: "runtime.message",
      data: {
        kind: sourceType,
        itemType: "unrecognized",
        contentRedacted: true,
      },
    },
  ];
}

function usageData(value: unknown): Record<string, number> {
  if (!isObject(value)) {
    return {};
  }
  const mappings = [
    ["inputTokens", "input_tokens"],
    ["cachedInputTokens", "cached_input_tokens"],
    ["cacheWriteInputTokens", "cache_write_input_tokens"],
    ["outputTokens", "output_tokens"],
    ["reasoningOutputTokens", "reasoning_output_tokens"],
  ] as const;
  const usage: Record<string, number> = {};
  for (const [target, source] of mappings) {
    const number = nonNegativeInteger(value[source]);
    if (number !== undefined) {
      usage[target] = number;
    }
  }
  return usage;
}

function conservativeRawMetadata(): Record<string, unknown> {
  const raw = {
    namespace: "openai.codex",
    payload: { redacted: true },
    redaction: {
      applied: true,
      policyVersion: "codex-adapter-conservative-v1",
      categories: ["untrusted_runtime_payload"],
      replacements: 1,
    },
  };
  const bytes = Buffer.byteLength(JSON.stringify(raw), "utf8");
  if (bytes > CODEX_RAW_METADATA_MAX_BYTES) {
    throw new Error("Codex conservative raw metadata exceeds its fixed byte limit");
  }
  return raw;
}

function optionalInteger(key: string, value: unknown): Record<string, number> {
  const number = Number.isInteger(value) ? (value as number) : undefined;
  return number === undefined ? {} : { [key]: number };
}

function nonNegativeInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
