import type { WorkforceEvent } from "@workforce/protocol";

import { redactDiagnostic, type DiagnosticExport } from "./diagnostics.js";
import { redactEvent } from "./event.js";
import {
  RedactionStream,
  SecretRedactor,
  type RedactionResult,
  type RedactionSummary,
  type SecretRedactorOptions,
} from "./redact.js";

/**
 * Named output channels that share one redactor (and therefore known secrets)
 * while keeping per-stream lookbehind so a secret split across chunks cannot
 * leak. stdout / stderr / JSONL / diagnostic raw are separate buffers.
 */
export class ChunkedOutputRedactor {
  private readonly channels = new Map<string, RedactionStream>();

  constructor(private readonly redactor: SecretRedactor) {}

  stream(name: string): RedactionStream {
    let existing = this.channels.get(name);
    if (existing === undefined) {
      existing = this.redactor.createStream();
      this.channels.set(name, existing);
    }
    return existing;
  }

  push(name: string, chunk: string): string {
    return this.stream(name).push(chunk);
  }

  flush(name?: string): string {
    if (name !== undefined) {
      return this.stream(name).flush();
    }
    const parts: string[] = [];
    for (const stream of this.channels.values()) {
      parts.push(stream.flush());
    }
    return parts.join("");
  }
}

export interface RedactionSurface {
  redactor: SecretRedactor;
  outputs: ChunkedOutputRedactor;
  redactEvent: (event: WorkforceEvent) => { event: WorkforceEvent; summary: RedactionSummary };
  redactDiagnostic: (input: DiagnosticExport) => {
    diagnostic: DiagnosticExport;
    summary: RedactionSummary;
  };
  redactError: (error: unknown) => RedactionResult<{ message: string; details?: unknown }>;
  redactRaw: (payload: unknown) => RedactionResult<unknown>;
}

/** Bind known injected secrets, then redact Event / raw / diagnostic / chunked streams. */
export function createRedactionSurface(options: SecretRedactorOptions = {}): RedactionSurface {
  const redactor = new SecretRedactor(options);
  const outputs = new ChunkedOutputRedactor(redactor);
  return {
    redactor,
    outputs,
    redactEvent: (event) => redactEvent(event, redactor),
    redactDiagnostic: (input) => redactDiagnostic(input, redactor),
    redactError: (error) => redactor.redactError(error),
    redactRaw: (payload) => redactor.redactRaw(payload),
  };
}

export function secretsFromInjection(injection: {
  extraEnv?: Readonly<{ key: string; value: string }>;
  stdinSecret?: string;
}): string[] {
  const secrets: string[] = [];
  if (injection.extraEnv?.value) {
    secrets.push(injection.extraEnv.value);
  }
  if (injection.stdinSecret) {
    secrets.push(injection.stdinSecret);
  }
  return secrets;
}
