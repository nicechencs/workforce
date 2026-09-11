import { taskDependencySchema, type TaskDependency } from "@workforce/protocol";

import type { TaskRecord } from "../projects/store.js";

export function mapPublishedTaskDependsOn(
  task: Pick<TaskRecord, "dependsOn">,
): TaskDependency[] {
  return task.dependsOn.map((edge) =>
    taskDependencySchema.parse({
      taskId: edge.taskId,
      waitFor: edge.waitFor === "completed" ? "completed" : "outputs_ready",
    }),
  );
}
