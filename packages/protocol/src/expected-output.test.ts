import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { acceptanceCriterionSchema, expectedOutputSchema } from "./expected-output.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/protocols/v0.1/fixtures",
);

describe("expectedOutputs", () => {
  it("requires stable id and kind", () => {
    const raw: unknown = JSON.parse(
      readFileSync(resolve(fixtures, "task.expected-outputs.json"), "utf8"),
    );
    const body = raw as {
      expectedOutputs: unknown[];
      acceptanceCriteria: unknown[];
    };
    for (const output of body.expectedOutputs) {
      const parsed = expectedOutputSchema.parse(output);
      expect(parsed.id.length).toBeGreaterThan(0);
    }
    for (const criterion of body.acceptanceCriteria) {
      expect(acceptanceCriterionSchema.parse(criterion).id.length).toBeGreaterThan(0);
    }
  });

  it("rejects API-draft outputs that only have type", () => {
    expect(() => expectedOutputSchema.parse({ type: "code_change", required: true })).toThrow();
  });
});
