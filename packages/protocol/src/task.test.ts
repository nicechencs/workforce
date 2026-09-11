import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseTaskDependsOn, parseTaskDto, taskDtoSchema } from "./task.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/protocols/v0.1/fixtures",
);

describe("public TaskDto dependsOn", () => {
  it("requires dependsOn edges from the published DAG fixture", () => {
    const raw: unknown = JSON.parse(readFileSync(resolve(fixtures, "task.depends-on.json"), "utf8"));
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
});
