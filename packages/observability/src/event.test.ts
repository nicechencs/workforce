import { describe, expect, it } from "vitest";

import type { WorkforceEvent } from "@workforce/protocol";

import { redactEvent } from "./event.js";
import { REDACTED, SecretRedactor } from "./redact.js";

const TOKEN = "sk-proj-eventpayloadtoken0001";

function sampleEvent(overrides: Partial<WorkforceEvent> = {}): WorkforceEvent {
  return {
    specVersion: "0.1",
    id: "evt_1",
    type: "runtime.output.appended",
    source: "workforce.runtime",
    subject: { type: "run", id: "run_1" },
    time: "2026-09-10T00:00:00.000Z",
    recordedAt: "2026-09-10T00:00:00.000Z",
    actor: { type: "runtime", id: "mock" },
    stream: "run:run_1",
    correlationId: "cor_1",
    dataContentType: "application/json",
    dataSchema: "workforce.runtime.output.0.1",
    data: { chunk: `token ${TOKEN}` },
    sensitivity: "internal",
    ...overrides,
  };
}

describe("redactEvent", () => {
  it("redacts event data and namespaced raw extensions without recording the secret", () => {
    const redactor = new SecretRedactor();
    const { event, summary } = redactEvent(
      sampleEvent({
        extensions: { "vendor.openai.codex": { access_token: TOKEN, text: `hi ${TOKEN}` } },
      }),
      redactor,
    );
    expect(event.data.chunk).toBe(`token ${REDACTED}`);
    expect(event.extensions).toEqual({
      "vendor.openai.codex": { access_token: REDACTED, text: `hi ${REDACTED}` },
    });
    expect(event.redaction).toEqual(summary);
    expect(summary.applied).toBe(true);
    expect(JSON.stringify(event)).not.toContain(TOKEN);
  });
});
