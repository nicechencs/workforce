import type { ApprovalDto, ProjectDto, RunDto } from "@workforce/desktop-client";

import { isActiveRun } from "../runs/model.js";

const ACTIVE_PROJECT = new Set(["draft", "planning", "ready", "running", "paused"]);

export function pendingApprovals(items: ApprovalDto[]): ApprovalDto[] {
  return items.filter((item) => item.status === "pending");
}

export function activeRuns(items: RunDto[]): RunDto[] {
  return items.filter((item) => isActiveRun(item) || item.cancelRequested);
}

export function activeProjects(items: ProjectDto[]): ProjectDto[] {
  return items.filter((item) => ACTIVE_PROJECT.has(item.status));
}

export function projectStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "草稿";
    case "planning":
      return "规划中";
    case "ready":
      return "待启动";
    case "running":
      return "运行中";
    case "paused":
      return "已暂停";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}
