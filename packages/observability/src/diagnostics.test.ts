import { describe, expect, it } from "vitest";

import { redactDiagnostic } from "./diagnostics.js";
import { REDACTED, SecretRedactor } from "./redact.js";

const TOKEN = "sk-proj-diagnosticexport0001";
const AUTH = '{"OPENAI_API_KEY":"sk-proj-diagnosticexport0001","tokens":{"access_token":"aaa"}}';

describe("redactDiagnostic", () => {
  it("redacts env snapshots, auth.json, and error text in a diagnostic export", () => {
    const redactor = new SecretRedactor();
    const { diagnostic, summary } = redactDiagnostic(
      {
        kind: "runtime.diagnose",
        generatedAt: "2026-09-10T00:00:00.000Z",
        payload: {
          env: { OPENAI_API_KEY: TOKEN, PATH: "/usr/bin" },
          authJson: AUTH,
          error: { message: `login failed ${TOKEN}` },
          home: "C:\\Users\\alice\\.codex\\auth.json",
        },
      },
      redactor,
    );
    expect(diagnostic.payload).toMatchObject({
      env: { OPENAI_API_KEY: REDACTED, PATH: "/usr/bin" },
      error: { message: `login failed ${REDACTED}` },
    });
    expect(JSON.stringify(diagnostic)).not.toContain(TOKEN);
    expect(JSON.stringify(diagnostic)).not.toMatch(/Users\\alice/i);
    expect(JSON.stringify(summary)).not.toContain(TOKEN);
    expect(summary.applied).toBe(true);
  });
});
