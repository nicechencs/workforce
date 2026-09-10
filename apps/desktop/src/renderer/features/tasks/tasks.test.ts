import { describe, expect, it } from "vitest";

import type { RunDto, TaskDto } from "@workforce/desktop-client";

import {
  runStatusLabel,
  taskHeadlineStatus,
  taskKindNote,
  taskStatusLabel,
  visibleTaskActions,
} from "./model.js";

function task(partial: Partial<TaskDto> & Pick<TaskDto, "status">): TaskDto {
  return {
    id: "tsk_1",
    projectId: "prj_1",
    title: "Implement slice Alpha",
    objective: "Add Alpha",
    stateRevision: 1,
    definitionRevision: 1,
    generation: 1,
    attempt: 1,
    protocolVersion: "0.1",
    cancelRequested: false,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...partial,
  };
}

function run(partial: Partial<RunDto> & Pick<RunDto, "status">): RunDto {
  return {
    id: "run_1",
    taskId: "tsk_1",
    projectId: "prj_1",
    stateRevision: 1,
    definitionRevision: 1,
    generation: 1,
    attempt: 1,
    protocolVersion: "0.1",
    cancelRequested: false,
    usage: { costMinor: 0, currency: "USD", kind: "unknown" },
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...partial,
  };
}

describe("task vs run statuses", () => {
  it("keeps waiting_review on tasks and succeeded on runs", () => {
    expect(taskStatusLabel("waiting_review")).toBe("等待审查");
    expect(runStatusLabel("waiting_review")).toBe("运行 waiting_review");
    expect(runStatusLabel("succeeded")).toBe("运行成功");
    expect(taskStatusLabel("succeeded")).toBe("任务 succeeded");
    expect(taskStatusLabel("waiting_review")).not.toBe(runStatusLabel("waiting_review"));
    expect(taskKindNote()).toContain("Run");
  });

  it("shows 取消中 when cancel is accepted before status is cancelled", () => {
    expect(taskHeadlineStatus(task({ status: "running", cancelRequested: true }))).toBe("取消中");
    expect(taskHeadlineStatus(task({ status: "cancelled" }))).toBe("已取消");
  });
});

describe("task actions", () => {
  it("offers retry only for failed tasks", () => {
    expect(visibleTaskActions(task({ status: "running" })).map((a) => a.id)).toEqual(["cancel"]);
    expect(visibleTaskActions(task({ status: "failed" })).map((a) => a.id)).toEqual(["retry"]);
    expect(visibleTaskActions(task({ status: "completed" }))).toEqual([]);
    expect(visibleTaskActions(task({ status: "waiting_review" })).map((a) => a.id)).toEqual([
      "cancel",
    ]);
  });

  it("does not treat a succeeded run as a completed task", () => {
    const succeeded = run({ status: "succeeded" });
    expect(runStatusLabel(succeeded.status)).toBe("运行成功");
    expect(taskStatusLabel("completed")).toBe("已完成");
    expect(runStatusLabel(succeeded.status)).not.toBe(taskStatusLabel("completed"));
  });
});
