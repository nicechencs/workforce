import { describe, expect, it } from "vitest";

import { AppError } from "./errors.js";
import { assertStartOrchestrationAllowed, parseStartOrchestrationMode } from "./orchestration.js";

const capabilities = {
  protocolVersion: "0.1",
  apiVersion: "v1",
  run: { pause: false, resume: false, input: true, takeOver: false },
  project: { pause: false, resume: false, archive: false },
  orchestration: { workflowBound: true, direct: false },
};

describe("start orchestrationMode", () => {
  it("parses the frozen field and rejects the old executionMode name at parse time only when passed", () => {
    expect(parseStartOrchestrationMode(undefined)).toBeUndefined();
    expect(parseStartOrchestrationMode("workflow_bound")).toBe("workflow_bound");
    expect(parseStartOrchestrationMode("direct")).toBe("direct");
    expect(() => parseStartOrchestrationMode("local")).toThrow(AppError);
    expect(() => parseStartOrchestrationMode("executionMode")).toThrow(AppError);
  });

  it("allows omit/workflow_bound and refuses direct without probe", () => {
    expect(() => assertStartOrchestrationAllowed(undefined, capabilities)).not.toThrow();
    expect(() => assertStartOrchestrationAllowed("workflow_bound", capabilities)).not.toThrow();
    expect(() => assertStartOrchestrationAllowed("direct", capabilities)).toThrow(AppError);
    try {
      assertStartOrchestrationAllowed("direct", capabilities);
    } catch (error) {
      expect(error).toMatchObject({ code: "unsupported_capability" });
    }
  });
});
