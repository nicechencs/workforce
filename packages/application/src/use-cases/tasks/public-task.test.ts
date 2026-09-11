import { describe, expect, it } from "vitest";

import { mapPublishedTaskDependsOn } from "./public-task.js";

describe("mapPublishedTaskDependsOn", () => {
  it("copies published DAG edges into the public Task DTO field", () => {
    expect(
      mapPublishedTaskDependsOn({
        dependsOn: [
          { taskId: "tsk_alpha", waitFor: "outputs_ready" },
          { taskId: "tsk_bravo", waitFor: "completed" },
        ],
      }),
    ).toEqual([
      { taskId: "tsk_alpha", waitFor: "outputs_ready" },
      { taskId: "tsk_bravo", waitFor: "completed" },
    ]);
  });

  it("returns an empty list when the published node has no upstream", () => {
    expect(mapPublishedTaskDependsOn({ dependsOn: [] })).toEqual([]);
  });
});
