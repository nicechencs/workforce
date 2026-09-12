import { describe, expect, it } from "vitest";

import {
  parseStartDirectTaskRunAccepted,
  parseStartDirectTaskRunInput,
  startDirectTaskRunAcceptedSchema,
  startDirectTaskRunInputSchema,
} from "./direct-execution.js";

const validInput = {
  operationId: "op_direct_01",
  idempotencyKey: "direct-start-01",
  projectId: "prj_01",
  taskId: "tsk_01",
  expectedTaskStateRevision: 3,
  orchestrationMode: "direct" as const,
  placementIntent: { mode: "local_only" as const },
};

const validAccepted = {
  projectId: "prj_01",
  taskId: "tsk_01",
  runId: "run_01",
  orchestrationMode: "direct" as const,
};

describe("D18 direct task/run command", () => {
  it("parses a project-scoped direct start command", () => {
    expect(parseStartDirectTaskRunInput(validInput)).toEqual(validInput);
  });

  it("requires the literal direct mode and the project/task boundary", () => {
    expect(() =>
      parseStartDirectTaskRunInput({
        ...validInput,
        orchestrationMode: "workflow_bound",
      }),
    ).toThrow(/orchestrationMode/);

    expect(() =>
      parseStartDirectTaskRunInput({
        ...validInput,
        projectId: undefined,
      }),
    ).toThrow(/projectId/);

    expect(() =>
      parseStartDirectTaskRunInput({
        ...validInput,
        taskId: undefined,
      }),
    ).toThrow(/taskId/);
  });

  it("rejects client-owned resolved fields and workflow references", () => {
    expect(() =>
      parseStartDirectTaskRunInput({
        ...validInput,
        runId: "run_client_supplied",
      }),
    ).toThrow(/runId|unrecognized_keys/);

    expect(() =>
      parseStartDirectTaskRunInput({
        ...validInput,
        transport: "sdk",
      }),
    ).toThrow(/transport|unrecognized_keys/);

    expect(() =>
      parseStartDirectTaskRunInput({
        ...validInput,
        executionSnapshotId: "snp_should_not_be_here",
      }),
    ).toThrow(/executionSnapshotId/);

    expect(() =>
      parseStartDirectTaskRunInput({
        ...validInput,
        workflowInstanceId: "wfi_should_not_be_here",
      }),
    ).toThrow(/workflowInstanceId/);
  });

  it("requires a valid placement intent when supplied", () => {
    expect(() =>
      parseStartDirectTaskRunInput({
        ...validInput,
        placementIntent: {
          mode: "specific_node",
          nodeId: "",
        },
      }),
    ).toThrow(/nodeId/);
  });
});

describe("D18 direct accepted result", () => {
  it("returns only project/task/run references and direct mode", () => {
    expect(parseStartDirectTaskRunAccepted(validAccepted)).toEqual(validAccepted);
  });

  it("does not expose workflow advancement or accept a client-supplied result", () => {
    expect(() =>
      parseStartDirectTaskRunAccepted({
        ...validAccepted,
        workflowInstanceId: "wfi_1",
      }),
    ).toThrow(/workflowInstanceId/);

    expect(() =>
      parseStartDirectTaskRunAccepted({
        ...validAccepted,
        status: "completed",
      }),
    ).toThrow(/status|unrecognized_keys/);
  });

  it("keeps the schema strict at runtime", () => {
    expect(() =>
      startDirectTaskRunInputSchema.parse({ ...validInput, project: "wrong" }),
    ).toThrow();
    expect(() =>
      startDirectTaskRunAcceptedSchema.parse({ ...validAccepted, executionSnapshotId: "snp_1" }),
    ).toThrow();
  });
});
