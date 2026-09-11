import type { RunDto, TaskDto } from "@workforce/desktop-client";

export const TASK_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  blocked: "阻塞",
  ready: "就绪",
  queued: "排队中",
  running: "执行中",
  waiting_review: "等待审查",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export const RUN_STATUS_LABELS: Record<string, string> = {
  pending: "待启动",
  starting: "启动中",
  running: "运行中",
  waiting_input: "等待输入",
  paused: "已暂停",
  succeeded: "运行成功",
  failed: "运行失败",
  timed_out: "超时",
  cancelled: "已取消",
};

const TASK_TERMINAL = new Set(["completed", "failed", "cancelled"]);
const RUN_TERMINAL = new Set(["succeeded", "failed", "timed_out", "cancelled"]);

export type TaskActionId = "retry" | "cancel";

export interface TaskAction {
  id: TaskActionId;
  label: string;
  kind: "primary" | "danger";
  enabled: boolean;
}

export function taskStatusLabel(status: string): string {
  return TASK_STATUS_LABELS[status] ?? `任务 ${status}`;
}

export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABELS[status] ?? `运行 ${status}`;
}

export function taskHeadlineStatus(task: Pick<TaskDto, "status" | "cancelRequested">): string {
  if (task.cancelRequested && task.status !== "cancelled") {
    return "取消中";
  }
  return taskStatusLabel(task.status);
}

export function visibleTaskActions(
  task: Pick<TaskDto, "status" | "cancelRequested">,
): TaskAction[] {
  const actions: TaskAction[] = [];
  if (task.status === "failed") {
    actions.push({ id: "retry", label: "重试", kind: "primary", enabled: true });
  }
  if (!TASK_TERMINAL.has(task.status)) {
    actions.push({
      id: "cancel",
      label: task.cancelRequested ? "取消中" : "取消",
      kind: "danger",
      enabled: !task.cancelRequested,
    });
  }
  return actions;
}

export function isRunTerminal(status: string): boolean {
  return RUN_TERMINAL.has(status);
}

export function sortRunsNewestFirst(runs: RunDto[]): RunDto[] {
  return [...runs].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
}

export function sortTasksForDag(tasks: TaskDto[]): TaskDto[] {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const task of tasks) {
    incoming.set(task.id, 0);
    outgoing.set(task.id, []);
  }
  for (const task of tasks) {
    for (const edge of task.dependsOn ?? []) {
      if (!incoming.has(edge.taskId) || !incoming.has(task.id)) {
        continue;
      }
      outgoing.get(edge.taskId)?.push(task.id);
      incoming.set(task.id, (incoming.get(task.id) ?? 0) + 1);
    }
  }
  const queue = tasks
    .filter((task) => (incoming.get(task.id) ?? 0) === 0)
    .sort(compareTaskStable);
  const ordered: TaskDto[] = [];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) {
      break;
    }
    ordered.push(next);
    for (const childId of outgoing.get(next.id) ?? []) {
      const remaining = (incoming.get(childId) ?? 1) - 1;
      incoming.set(childId, remaining);
      if (remaining === 0) {
        const child = tasks.find((task) => task.id === childId);
        if (child) {
          queue.push(child);
          queue.sort(compareTaskStable);
        }
      }
    }
  }
  if (ordered.length === tasks.length) {
    return ordered;
  }
  return [...tasks].sort(compareTaskStable);
}

function compareTaskStable(a: TaskDto, b: TaskDto): number {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  return a.id < b.id ? -1 : 1;
}

export function taskKindNote(): string {
  return "任务状态与运行（Run）状态分开显示，不会混用 waiting_review / succeeded。";
}
