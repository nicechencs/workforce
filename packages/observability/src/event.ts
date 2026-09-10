import type { WorkforceEvent } from "@workforce/protocol";

import { mergeSummaries, type RedactionSummary, SecretRedactor } from "./redact.js";

export function redactEvent(
  event: WorkforceEvent,
  redactor: SecretRedactor,
): { event: WorkforceEvent; summary: RedactionSummary } {
  const data = redactor.redactJson(event.data);
  const extensions =
    event.extensions === undefined ? undefined : redactor.redactJson(event.extensions);
  const summary = mergeSummaries(redactor.policyVersion, [data.summary, extensions?.summary]);
  const next: WorkforceEvent = {
    ...event,
    data: asRecord(data.value),
    redaction: asRecord(summary),
  };
  if (extensions !== undefined) {
    next.extensions = asRecord(extensions.value);
  }
  return { event: next, summary };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}
