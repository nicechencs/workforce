import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseCreateTaskInput, parseTaskDependsOn, parseTaskDto, taskDtoSchema } from "./task.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/protocols/v0.1/fixtures",
);

describe("public TaskDto dependsOn", () => {
  it("requires dependsOn edges from the published DAG fixture", () => {
    const raw: unknown = JSON.parse(
      readFileSync(resolve(fixtures, "task.depends-on.json"), "utf8"),
    );
    const parsed = parseTaskDto(raw);
    expect(parsed.dependsOn).toEqual([
      { taskId: "tsk_dev_alpha", waitFor: "outputs_ready" },
      { taskId: "tsk_dev_bravo", waitFor: "outputs_ready" },
    ]);
    expect(parsed.workflowNodeId).toBe("review_integration");
  });

  it("accepts an empty dependsOn array for entry tasks", () => {
    const parsed = parseTaskDependsOn([]);
    expect(parsed).toEqual([]);
  });

  it("rejects omitted dependsOn and illegal waitFor values", () => {
    expect(() =>
      taskDtoSchema.parse({
        id: "tsk_1",
        projectId: "prj_1",
        title: "Alpha",
        objective: "Do work",
        status: "ready",
        stateRevision: 1,
        definitionRevision: 1,
        generation: 1,
        attempt: 1,
        protocolVersion: "0.1",
        cancelRequested: false,
        createdAt: "2026-09-11T00:00:00.000Z",
        updatedAt: "2026-09-11T00:00:00.000Z",
      }),
    ).toThrow();
    expect(() => parseTaskDependsOn([{ taskId: "tsk_1", waitFor: "started" }])).toThrow();
  });

  it("parses the HTTP create-task body and excludes server-owned fields", () => {
    expect(
      parseCreateTaskInput({
        protocol: "workforce.task",
        protocolVersion: "0.1",
        title: "Implement health endpoint",
        objective: "Expose a tested readiness endpoint.",
        priority: 50,
        context: { include: [], maxBytes: 524288 },
        budget: {},
        acceptanceCriteria: [
          {
            id: "ac_review",
            type: "review",
            description: "Reviewer approves the changes",
            reviewerRole: "code_reviewer",
            required: true,
          },
        ],
        expectedOutputs: [{ id: "out_code", kind: "code", required: true }],
      }),
    ).toMatchObject({ title: "Implement health endpoint", priority: 50 });

    expect(() =>
      parseCreateTaskInput({
        title: "Invalid",
        objective: "Contains a server-owned id",
        id: "tsk_server_owned",
      }),
    ).toThrow(/unrecognized_keys/);
  });

  it("rejects a missing data input value", () => {
    expect(() =>
      parseCreateTaskInput({
        title: "Invalid data input",
        objective: "The input must carry a value",
        inputs: [{ id: "data", name: "Data", required: true, type: "data" }],
      }),
    ).toThrow(/value/);
  });

  it("rejects an undefined inline input value", () => {
    expect(() =>
      parseCreateTaskInput({
        title: "Invalid inline input",
        objective: "The input must carry a value",
        inputs: [
          { id: "inline", name: "Inline", required: true, type: "inline", value: undefined },
        ],
      }),
    ).toThrow(/value/);
  });
});
