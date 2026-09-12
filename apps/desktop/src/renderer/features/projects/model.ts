import type {
  ArtifactDto,
  ArtifactVersionSummaryDto,
  CapabilitiesDto,
  ProjectDto,
  RunDto,
  TaskDto,
} from "@workforce/desktop-client";

import { isActiveRun } from "../runs/model.js";
import { sortRunsNewestFirst } from "../tasks/model.js";
import { errorMessage, isRevisionConflict, revisionConflictMessage } from "./command.js";
import { PRESET_RUNTIME_ID, PRESET_TEAM, PRESET_TEAM_ID } from "../teams/model.js";

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  planning: "规划中",
  ready: "就绪",
  running: "执行中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  archived: "已归档",
};

const PROJECT_TERMINAL = new Set(["completed", "failed", "cancelled", "archived"]);

export type ProjectActionId =
  "startPlanning" | "confirmPlan" | "startProject" | "cancel" | "pause" | "resume" | "archive";

export interface ProjectAction {
  id: ProjectActionId;
  label: string;
  kind: "primary" | "secondary" | "danger";
  enabled: boolean;
}

export interface ProjectActionInput {
  status: string;
  cancelRequested: boolean;
  planArtifactVersionId?: string;
  workspaceBound: boolean;
  teamSelected: boolean;
  runtimeSelected: boolean;
  capabilities: CapabilitiesDto["project"];
}

export const HIDDEN_PROJECT_CAPABILITIES: CapabilitiesDto["project"] = {
  pause: false,
  resume: false,
  archive: false,
};

export function defaultCapabilities(): CapabilitiesDto {
  return {
    protocolVersion: "0.1",
    apiVersion: "v1",
    run: { pause: false, resume: false, input: false, takeOver: false },
    project: { ...HIDDEN_PROJECT_CAPABILITIES },
  };
}

export function isDraftConfigComplete(input: {
  workspaceBound: boolean;
  teamSelected: boolean;
  runtimeSelected: boolean;
}): boolean {
  return input.workspaceBound && input.teamSelected && input.runtimeSelected;
}

export function projectStatusLabel(project: { status: string; cancelRequested: boolean }): string {
  if (project.cancelRequested && project.status !== "cancelled") {
    return "取消中";
  }
  return PROJECT_STATUS_LABELS[project.status] ?? `项目 ${project.status}`;
}

export function statusBadgeTone(
  status: string,
  cancelRequested: boolean,
): "health" | "warning" | "danger" | "muted" {
  if (cancelRequested && status !== "cancelled") {
    return "warning";
  }
  if (status === "completed" || status === "ready") {
    return "health";
  }
  if (status === "failed") {
    return "danger";
  }
  if (status === "running" || status === "planning") {
    return "warning";
  }
  return "muted";
}

export function visibleProjectActions(input: ProjectActionInput): ProjectAction[] {
  const actions: ProjectAction[] = [];
  const terminal = PROJECT_TERMINAL.has(input.status);
  const configReady = isDraftConfigComplete({
    workspaceBound: input.workspaceBound,
    teamSelected: input.teamSelected,
    runtimeSelected: input.runtimeSelected,
  });

  if (input.status === "draft") {
    actions.push({
      id: "startPlanning",
      label: "开始规划",
      kind: "primary",
      enabled: configReady && !input.cancelRequested,
    });
  }

  if (input.status === "planning") {
    const hasPlan = (input.planArtifactVersionId ?? "").length > 0;
    actions.push({
      id: "confirmPlan",
      label: "确认计划",
      kind: "primary",
      enabled: hasPlan && !input.cancelRequested,
    });
  }

  if (input.status === "ready") {
    actions.push({
      id: "startProject",
      label: "开始执行",
      kind: "primary",
      enabled: !input.cancelRequested,
    });
  }

  if (input.status === "running" && input.capabilities.pause) {
    actions.push({ id: "pause", label: "暂停", kind: "secondary", enabled: true });
  }

  if (input.status === "paused" && input.capabilities.resume) {
    actions.push({ id: "resume", label: "继续", kind: "primary", enabled: true });
  }

  if (!terminal) {
    actions.push({
      id: "cancel",
      label: input.cancelRequested ? "取消中" : "取消",
      kind: "danger",
      enabled: !input.cancelRequested,
    });
  }

  return actions;
}

export function hiddenIllegalActions(input: ProjectActionInput): ProjectActionId[] {
  const visible = new Set(visibleProjectActions(input).map((action) => action.id));
  const all: ProjectActionId[] = [
    "startPlanning",
    "confirmPlan",
    "startProject",
    "cancel",
    "pause",
    "resume",
    "archive",
  ];
  return all.filter((id) => !visible.has(id));
}

export interface CreateProjectFormState {
  name: string;
  objective: string;
  error: string | null;
  needsRefresh: boolean;
  submitting: boolean;
}

export const emptyCreateForm: CreateProjectFormState = {
  name: "",
  objective: "",
  error: null,
  needsRefresh: false,
  submitting: false,
};

export type CreateProjectFormEvent =
  | { type: "change"; field: "name" | "objective"; value: string }
  | { type: "submit" }
  | { type: "success" }
  | { type: "failure"; error: unknown };

export function reduceCreateProjectForm(
  state: CreateProjectFormState,
  event: CreateProjectFormEvent,
): CreateProjectFormState {
  switch (event.type) {
    case "change":
      return { ...state, [event.field]: event.value, error: null };
    case "submit":
      return { ...state, submitting: true, error: null, needsRefresh: false };
    case "success":
      return { ...state, submitting: false, error: null, needsRefresh: false };
    case "failure":
      return applyFormFailure(state, event.error);
  }
}

export interface ProjectEditForm {
  name: string;
  objective: string;
  error: string | null;
  needsRefresh: boolean;
  submitting: boolean;
}

export function projectEditForm(project: Pick<ProjectDto, "name" | "objective">): ProjectEditForm {
  return {
    name: project.name,
    objective: project.objective,
    error: null,
    needsRefresh: false,
    submitting: false,
  };
}

export function applyFormFailure<
  T extends { error: string | null; needsRefresh: boolean; submitting: boolean },
>(form: T, error: unknown): T {
  const conflict = isRevisionConflict(error);
  return {
    ...form,
    submitting: false,
    needsRefresh: conflict,
    error: conflict ? revisionConflictMessage() : errorMessage(error),
  };
}

export function applyProjectRefresh<
  T extends { name: string; objective: string; error: string | null; needsRefresh: boolean },
>(form: T, server: Pick<ProjectDto, "name" | "objective">, keepInput: boolean): T {
  if (keepInput) {
    return { ...form, error: null, needsRefresh: false };
  }
  return {
    ...form,
    name: server.name,
    objective: server.objective,
    error: null,
    needsRefresh: false,
  };
}

export function publicWorkspaceLabel(grant: { displayLabel: string } | null): string {
  if (!grant) {
    return "未绑定";
  }
  return grant.displayLabel;
}

export function budgetPlaceholder(budget: unknown): string {
  if (budget && typeof budget === "object") {
    const record = budget as Record<string, unknown>;
    const kind = record.kind;
    const currency = typeof record.currency === "string" ? record.currency : "";
    if (kind === "unknown") {
      return currency
        ? `预算：未知（${currency}，不得当作已结算金额）`
        : "预算：未知（不得当作已结算金额）";
    }
    const minor = (value: unknown): number | undefined =>
      typeof value === "number" ? value : undefined;
    // ProjectBudgetDto carries reserved/settled/limit as costMinor integers, never a bare costMinor.
    const limit = minor(record.estimatedLimitMinor) ?? minor(record.settledLimitMinor);
    const parts: string[] = [];
    const reserved = minor(record.reservedMinor);
    if (reserved !== undefined) {
      parts.push(`已预留 ${reserved}`);
    }
    const settled = minor(record.settledMinor);
    if (settled !== undefined) {
      parts.push(`已结算 ${settled}`);
    }
    if (limit !== undefined) {
      parts.push(`上限 ${limit}`);
    }
    if (parts.length > 0) {
      return `预算：${parts.join(" · ")}${currency ? `（${currency} 最小货币单位）` : ""}`;
    }
    if (typeof record.costMinor === "number" && kind !== undefined) {
      return `预算：${String(record.costMinor)} ${currency}`.trim();
    }
  }
  return "预算：不可用（未返回可识别的预算字段；未知用量不得当作已结算金额）";
}

export function pendingApprovalCount(items: Array<{ status: string }>): number {
  return items.filter((item) => item.status === "pending").length;
}

export function presetTeamCopy(): { id: string; name: string; runtime: string } {
  return { id: PRESET_TEAM.id, name: PRESET_TEAM.name, runtime: PRESET_TEAM.runtime.label };
}

export function defaultDraftSelection(): {
  teamId: string;
  teamVersionId: string;
  runtimeId: string;
} {
  return {
    teamId: PRESET_TEAM_ID,
    teamVersionId: PRESET_TEAM.versionId,
    runtimeId: PRESET_RUNTIME_ID,
  };
}

export function nodeScopeLabel(): string {
  return "本机 Local Node（V0.1 仅本机，远程节点未接入）";
}

export function projectProgressLabel(tasks: Array<Pick<TaskDto, "status">>): string {
  if (tasks.length === 0) {
    return "进度：尚无已发布任务";
  }
  const completed = tasks.filter((task) => task.status === "completed").length;
  const running = tasks.filter(
    (task) => task.status === "running" || task.status === "queued",
  ).length;
  const runningNote = running > 0 ? ` · ${running} 进行中` : "";
  return `进度：${completed}/${tasks.length} 已完成${runningNote}`;
}

export function taskOwnerLabel(task: Pick<TaskDto, "role">): string {
  return task.role && task.role.length > 0 ? task.role : "未指定";
}

export function taskDependencyLabel(
  task?: Pick<TaskDto, "dependsOn">,
  tasks: Array<Pick<TaskDto, "id" | "title" | "workflowNodeId">> = [],
): string {
  if (!task || task.dependsOn === undefined) {
    return "依赖：未返回";
  }
  if (task.dependsOn.length === 0) {
    return "依赖：无";
  }
  const labels = task.dependsOn.map((edge) => {
    const upstream = tasks.find((item) => item.id === edge.taskId);
    const name = upstream?.workflowNodeId ?? upstream?.title ?? edge.taskId;
    return `${name}（${edge.waitFor}）`;
  });
  return `依赖：${labels.join("、")}`;
}

export function emptyTasksCopy(status: string): string {
  if (status === "draft" || status === "planning") {
    return "确认计划后才会发布执行任务图。";
  }
  return "暂无任务。";
}

export function splitProjectRuns(runs: RunDto[]): { current: RunDto[]; history: RunDto[] } {
  const sorted = sortRunsNewestFirst(runs);
  return {
    current: sorted.filter((run) => isActiveRun(run)),
    history: sorted.filter((run) => !isActiveRun(run)),
  };
}

const ARTIFACT_KIND_LABELS: Record<string, string> = {
  git_diff: "代码",
  plan: "文档",
  document: "文档",
  evaluation: "报告",
  test_result: "报告",
  report: "报告",
  external: "外部资源",
};

export function artifactKindLabel(kind: string): string {
  return ARTIFACT_KIND_LABELS[kind] ?? kind;
}

export function pinnedArtifactVersion(
  artifact: Pick<ArtifactDto, "versions">,
): ArtifactVersionSummaryDto | null {
  if (artifact.versions.length === 0) {
    return null;
  }
  return [...artifact.versions].sort((left, right) => right.version - left.version)[0] ?? null;
}

export function projectPolicyCopy(capabilities: CapabilitiesDto["project"]): string {
  return `项目策略写入尚未接入公开 API。当前能力：暂停 ${capabilities.pause ? "支持" : "不支持"}，继续 ${capabilities.resume ? "支持" : "不支持"}，归档 ${capabilities.archive ? "支持" : "不支持"}（归档按钮仍不渲染）。`;
}

export function projectFromDto(
  project: ProjectDto,
  extras: {
    workspaceBound: boolean;
    capabilities: CapabilitiesDto["project"];
    teamSelected?: boolean;
    runtimeSelected?: boolean;
  },
): { actions: ProjectAction[]; statusLabel: string; hidden: ProjectActionId[] } {
  const input: ProjectActionInput = {
    status: project.status,
    cancelRequested: project.cancelRequested,
    workspaceBound: extras.workspaceBound,
    teamSelected: extras.teamSelected ?? true,
    runtimeSelected: extras.runtimeSelected ?? true,
    capabilities: extras.capabilities,
  };
  if (project.planArtifactVersionId !== undefined) {
    input.planArtifactVersionId = project.planArtifactVersionId;
  }
  return {
    actions: visibleProjectActions(input),
    statusLabel: projectStatusLabel(project),
    hidden: hiddenIllegalActions(input),
  };
}
