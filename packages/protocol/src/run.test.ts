import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseStartRunRequest } from "./command.js";
import { parseRunStatus } from "./run.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/protocols/v0.1/fixtures",
);

describe("RunStatus", () => {
  it("rejects waiting_review on a Run", () => {
    const raw: unknown = JSON.parse(
      readFileSync(resolve(fixtures, "illegal.run.waiting_review.json"), "utf8"),
    );
    const status = (raw as { status: unknown }).status;
    expect(() => parseRunStatus(status)).toThrow(/illegal RunStatus/);
  });

  it("parses the M3 start-run command fixture", () => {
    const raw: unknown = JSON.parse(
      readFileSync(resolve(fixtures, "command.run.start.json"), "utf8"),
    );
    const command = parseStartRunRequest(raw);
    expect(command.placement.executionNodeId).toMatch(/^ndl_/);
    expect(command.attempt).toBe(1);
    expect(command.orchestrationMode).toBe("workflow_bound");
  });
});
