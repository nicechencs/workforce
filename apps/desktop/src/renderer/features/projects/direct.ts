import type { DesktopClient, TaskDto } from "@workforce/desktop-client";

import type { OrchestrationProbe } from "../orchestration/model.js";
import { startDirectTaskRun } from "../orchestration/start-task-run.js";
import { commandOptions } from "./command.js";

export const PROJECT_DIRECT_ADHOC_NOTE =
  "未选 Task 时先 POST /projects/{id}/tasks 建项目内 ad-hoc Task，再 POST /tasks/{id}/runs（orchestrationMode=direct）。返回 Run 引用，不是 completed。没有 :direct URL。";

export const PROJECT_DIRECT_EMPTY_OPTION = "未选择（空则先建项目内 ad-hoc Task）";

export interface StartProjectDirectResult {
  taskId: string;
  createdAdHocTask: boolean;
}

/**
 * Project-page direct start. Same HTTP as Chat「去做」:
 * optional `POST /projects/{id}/tasks`, then `POST /tasks/{id}/runs`
 * with orchestrationMode=direct. Does not invent `:direct`.
 */
export async function startProjectDirectExecution(args: {
  client: DesktopClient;
  projectId: string;
  title: string;
  selectedTaskId: string;
  tasks: readonly Pick<TaskDto, "id" | "stateRevision">[];
  probe: OrchestrationProbe;
}): Promise<StartProjectDirectResult> {
  const selectedTaskId = args.selectedTaskId.trim();
  if (selectedTaskId.length > 0) {
    const existing = args.tasks.find((item) => item.id === selectedTaskId);
    await startDirectTaskRun({
      client: args.client,
      taskId: selectedTaskId,
      probe: args.probe,
      options: commandOptions(existing?.stateRevision),
    });
    return { taskId: selectedTaskId, createdAdHocTask: false };
  }

  const createInput: { title?: string } = {};
  const title = args.title.trim();
  if (title.length > 0) {
    createInput.title = title;
  }
  const task = await args.client.createAdHocTask(args.projectId, commandOptions(), createInput);
  await startDirectTaskRun({
    client: args.client,
    taskId: task.id,
    probe: args.probe,
    options: commandOptions(task.stateRevision),
  });
  return { taskId: task.id, createdAdHocTask: true };
}
