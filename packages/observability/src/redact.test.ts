import { describe, expect, it } from "vitest";

import { REDACTED, SecretRedactor } from "./redact.js";

const OPENAI_KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz0123";
const KNOWN = "SUPERSECRET_T07_VALUE";

function dumped(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function assertNoLeak(value: unknown, secret: string): void {
  expect(dumped(value)).not.toContain(secret);
}

describe("SecretRedactor", () => {
  it("redacts tokens, auth.json fields, errors, and raw payloads", () => {
    const redactor = new SecretRedactor({ knownSecrets: [KNOWN] });
    const text = redactor.redactText(`login ${OPENAI_KEY} and ${KNOWN}`);
    expect(text.value).toContain(REDACTED);
    assertNoLeak(text.value, OPENAI_KEY);
    assertNoLeak(text.value, KNOWN);

    const auth = redactor.redactJson({
      OPENAI_API_KEY: OPENAI_KEY,
      tokens: { access_token: "tok_live_abcdef", refresh_token: "rt_abcdef" },
    });
    expect(auth.value).toEqual({
      OPENAI_API_KEY: REDACTED,
      tokens: { access_token: REDACTED, refresh_token: REDACTED },
    });
    assertNoLeak(auth, OPENAI_KEY);
    assertNoLeak(auth, "tok_live_abcdef");

    const err = redactor.redactError(new Error(`spawn failed: ${OPENAI_KEY}`));
    assertNoLeak(err, OPENAI_KEY);
    expect(err.value.message).toContain(REDACTED);

    const raw = redactor.redactRaw({
      "raw.openai.codex": { authorization: `Bearer ${OPENAI_KEY}`, chunk: KNOWN },
    });
    assertNoLeak(raw, OPENAI_KEY);
    assertNoLeak(raw, KNOWN);
    expect(raw.summary.applied).toBe(true);
    expect(JSON.stringify(raw.summary)).not.toContain(OPENAI_KEY);
    expect(JSON.stringify(raw.summary)).not.toContain(KNOWN);
  });

  it("redacts a known secret split across stream chunks", () => {
    const redactor = new SecretRedactor({ knownSecrets: [KNOWN], lookbehind: 8 });
    const stream = redactor.createStream();
    const prefix = "log ";
    const splitAt = 6;
    const first = stream.push(prefix + KNOWN.slice(0, splitAt));
    const second = stream.push(KNOWN.slice(splitAt) + " leaked");
    const output = first + second + stream.flush();
    expect(output).toBe(`log ${REDACTED} leaked`);
    assertNoLeak(output, KNOWN);
    assertNoLeak(first, KNOWN);
    assertNoLeak(second, KNOWN);
  });

  it("redacts an API token split across JSONL chunks", () => {
    const redactor = new SecretRedactor({ lookbehind: 24 });
    const stream = redactor.createStream();
    const line = `{"type":"token","value":"${OPENAI_KEY}"}`;
    const cut = line.indexOf("sk-proj-") + 10;
    const output = stream.push(line.slice(0, cut)) + stream.push(line.slice(cut)) + stream.flush();
    expect(output).toContain(REDACTED);
    assertNoLeak(output, OPENAI_KEY);
  });

  it("does not emit a partial secret before flush when the window still holds it", () => {
    const redactor = new SecretRedactor({ knownSecrets: [KNOWN], lookbehind: 64 });
    const stream = redactor.createStream();
    const mid = stream.push(KNOWN.slice(0, 4));
    expect(mid).toBe("");
    const rest = stream.push(`${KNOWN.slice(4)} done`);
    const output = mid + rest + stream.flush();
    assertNoLeak(output, KNOWN);
    expect(output).toBe(`${REDACTED} done`);
  });
});
