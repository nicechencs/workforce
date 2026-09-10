import type { CapabilitiesDto, ProjectDto } from "@workforce/desktop-client";

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
    if (typeof record.costMinor === "number" && kind !== undefined) {
      return `预算：${String(record.costMinor)} ${currency}`.trim();
    }
  }
  return "预算：待接入 GET /projects/{id}/budget（未知用量不得当作已结算金额）";
}

export function pendingApprovalCount(items: Array<{ status: string }>): number {
  return items.filter((item) => item.status === "pending").length;
}

export function presetTeamCopy(): { id: string; name: string; runtime: string } {
  return { id: PRESET_TEAM.id, name: PRESET_TEAM.name, runtime: PRESET_TEAM.runtime.label };
}

export function defaultDraftSelection(): { teamId: string; runtimeId: string } {
  return { teamId: PRESET_TEAM_ID, runtimeId: PRESET_RUNTIME_ID };
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
