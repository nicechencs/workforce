import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseStartRunRequest } from "./command.js";
import {
  DEFAULT_ORCHESTRATION_MODE,
  parseOrchestrationMode,
} from "./orchestration.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/protocols/v0.1/fixtures",
);

function startFixture(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(fixtures, "command.run.start.json"), "utf8"),
  ) as Record<string, unknown>;
}

describe("orchestrationMode", () => {
  it("parses workflow_bound and direct", () => {
    expect(parseOrchestrationMode("workflow_bound")).toBe("workflow_bound");
    expect(parseOrchestrationMode("direct")).toBe("direct");
  });

  it("rejects unknown values including placement and the old executionMode name", () => {
    for (const junk of [
      "junk",
      "local",
      "remote",
      "container",
      "executionMode",
      "workflow-bound",
      "automatic",
      "local_only",
    ]) {
      expect(() => parseOrchestrationMode(junk)).toThrow(/illegal OrchestrationMode/);
    }
    expect(() => parseOrchestrationMode(1)).toThrow();
    expect(() => parseOrchestrationMode(null)).toThrow();
    expect(() => parseOrchestrationMode(undefined)).toThrow();
  });

  it("defaults the M3 start-run fixture to workflow_bound without changing other fields", () => {
    const raw = startFixture();
    expect(raw.orchestrationMode).toBeUndefined();
    const command = parseStartRunRequest(raw);
    expect(command.orchestrationMode).toBe(DEFAULT_ORCHESTRATION_MODE);
    expect(command.orchestrationMode).toBe("workflow_bound");
    expect(command.placement.executionNodeId).toMatch(/^ndl_/);
    expect(command.attempt).toBe(1);
    expect(command.runtime.adapterId).toBe("mock");
  });

  it("accepts an explicit workflow_bound or direct on StartRunRequest", () => {
    const bound = parseStartRunRequest({
      ...startFixture(),
      orchestrationMode: "workflow_bound",
    });
    const direct = parseStartRunRequest({
      ...startFixture(),
      orchestrationMode: "direct",
    });
    expect(bound.orchestrationMode).toBe("workflow_bound");
    expect(direct.orchestrationMode).toBe("direct");
  });

  it("rejects junk orchestrationMode and the old executionMode key on StartRunRequest", () => {
    expect(() => parseStartRunRequest({ ...startFixture(), orchestrationMode: "junk" })).toThrow();
    expect(() => parseStartRunRequest({ ...startFixture(), orchestrationMode: "local" })).toThrow();
    expect(() => parseStartRunRequest({ ...startFixture(), executionMode: "direct" })).toThrow();
  });
});
