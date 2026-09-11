import { SecretRedactor, type RedactionSummary } from "@workforce/observability";
import type { RuntimeEvent } from "@workforce/runtime-spi";
import { RuntimeSdkError } from "@workforce/runtime-sdk";

const DEFAULT_MAX_LINE_BYTES = 256 * 1024;
const DEFAULT_MAX_RAW_BYTES = 16 * 1024;

type JsonObject = Record<string, unknown>;

export interface CodexJsonlDecoderOptions {
  redactor?: SecretRedactor;
  now?: () => Date;
  maxLineBytes?: number;
  maxRawBytes?: number;
}

type TranslatedEvent = { type: string; data: Record<string, unknown> };

/**
 * Incrementally decodes Codex JSONL. Its cursor is only an in-memory source
 * position for dedupe; it is not resumable after the process/adapter restarts.
 */
export class CodexJsonlDecoder {
  private readonly redactor: SecretRedactor;
  private readonly now: () => Date;
  private readonly maxLineBytes: number;
  private readonly maxRawBytes: number;
  private buffer = "";
  private sourceLine = 0;
  private adapterSequence = 0;

  constructor(options: CodexJsonlDecoderOptions = {}) {
    this.redactor = options.redactor ?? new SecretRedactor();
    this.now = options.now ?? (() => new Date());
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    this.maxRawBytes = options.maxRawBytes ?? DEFAULT_MAX_RAW_BYTES;
  }

  push(chunk: string): RuntimeEvent[] {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
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
    const bytes = Buffer.byteLength(line, "utf8");
    if (bytes > this.maxLineBytes) {
      throw new RuntimeSdkError("validation_failed", "Codex JSONL line exceeds adapter limit", {
        details: { sourceLine: this.sourceLine, bytes, maxLineBytes: this.maxLineBytes },
      });
    }

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

    const translated = translateCodexEvent(parsed, this.redactor);
    const raw = boundedRaw(parsed, this.redactor, this.maxRawBytes);
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
          raw: {
            namespace: "openai.codex",
            payload: raw.payload,
            redaction: raw.summary,
          },
        },
      };
    });
  }
}

function translateCodexEvent(event: JsonObject, redactor: SecretRedactor): TranslatedEvent[] {
  const sourceType = stringValue(event["type"]) ?? "unknown";
  switch (sourceType) {
    case "thread.started":
      return [
        {
          type: "runtime.started",
          data: optionalText("threadId", event["thread_id"], redactor),
        },
      ];
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
          data: optionalText("message", event["message"], redactor),
        },
      ];
    case "error":
      return [
        {
          type: "runtime.message",
          data: {
            level: "error",
            ...optionalText("message", event["message"], redactor),
          },
        },
      ];
    case "item.started":
    case "item.updated":
    case "item.completed":
      return translateItem(sourceType, event["item"], redactor);
    default:
      return [
        {
          type: "runtime.message",
          data: { kind: "codex_event", sourceType: redactor.redactText(sourceType).value },
        },
      ];
  }
}

function translateItem(
  sourceType: "item.started" | "item.updated" | "item.completed",
  value: unknown,
  redactor: SecretRedactor,
): TranslatedEvent[] {
  if (!isObject(value)) {
    return [{ type: "runtime.message", data: { kind: sourceType, malformedItem: true } }];
  }
  const itemType = stringValue(value["type"]) ?? "unknown";
  const itemId = optionalText("itemId", value["id"], redactor);
  if (itemType === "command_execution") {
    if (sourceType === "item.started") {
      return [
        {
          type: "runtime.command.started",
          data: { ...itemId, ...optionalText("command", value["command"], redactor) },
        },
      ];
    }
    if (sourceType === "item.updated") {
      return [
        {
          type: "runtime.command.output",
          data: {
            ...itemId,
            ...optionalText("output", value["aggregated_output"] ?? value["output"], redactor),
          },
        },
      ];
    }
    return [
      {
        type: "runtime.command.completed",
        data: {
          ...itemId,
          ...optionalInteger("exitCode", value["exit_code"]),
          ...optionalText("status", value["status"], redactor),
        },
      },
    ];
  }
  if (itemType === "agent_message" && sourceType === "item.completed") {
    return [
      {
        type: "runtime.message",
        data: {
          ...itemId,
          role: "assistant",
          ...optionalText("content", value["text"], redactor),
        },
      },
    ];
  }
  if (itemType === "file_change" && sourceType === "item.completed") {
    return [{ type: "runtime.file.changed", data: itemId }];
  }
  return [
    {
      type: "runtime.message",
      data: {
        kind: sourceType,
        itemType: redactor.redactText(itemType).value,
        ...itemId,
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

function boundedRaw(
  value: unknown,
  redactor: SecretRedactor,
  maxBytes: number,
): { payload: unknown; summary: RedactionSummary } {
  const result = redactor.redactRaw(value);
  const serialized = JSON.stringify(result.value);
  if (Buffer.byteLength(serialized, "utf8") <= maxBytes) {
    return { payload: result.value, summary: result.summary };
  }
  return {
    payload: {
      truncated: true,
      originalBytes: Buffer.byteLength(serialized, "utf8"),
      preview: serialized.slice(0, maxBytes),
    },
    summary: result.summary,
  };
}

function optionalText(
  key: string,
  value: unknown,
  redactor: SecretRedactor,
): Record<string, string> {
  const text = stringValue(value);
  return text === undefined ? {} : { [key]: redactor.redactText(text).value };
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
