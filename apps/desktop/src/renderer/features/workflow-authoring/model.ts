import type {
  AuthoringSessionViewDto,
  AuthoringTurnDto,
  CommandOptions,
  ProjectDto,
} from "@workforce/desktop-client";

export type { AuthoringSessionViewDto, AuthoringTurnDto, ProjectDto };

export const CHAT_SESSION_PROTOCOL_FROZEN = true;
export const AUTHORING_QUERY = "authoring";
export const AUTHORING_PATH = "/workflows?authoring=1";

export const CHAT_SESSION_GAP =
  "此页面使用项目范围的 Daemon AuthoringSession。消息正文只在 Daemon 进程内暂存，重启后不可恢复的消息会明确标记。";
export const AGENT_REPLY_GAP =
  "发送后会创建真实 AuthoringTurn；只有服务端进入“待确认”状态时才显示结构化提案，不会自动生成或发布工作流。";
export const AUTHORING_PROPOSAL_PREVIEW_NOTE =
  "这是服务端返回的结构化提案。必须明确确认后，才会落成未发布工作流草稿。";
export const AUTHORING_ROUTE_GAP =
  "会话始终绑定当前项目；切换项目会重新加载该项目的会话，不复用其他项目的消息或提案。";
export const DRAFT_NOT_RUNTIME_NOTE =
  "确认结果是未发布工作流草稿，不会自动发布、执行或创建 Task/Run。";
export const EMPTY_INTENT_NOTE =
  "空意图不会发送。当前对话、提案和草稿都保留，不会回退夹具或伪造成功。";
export const AUTHORING_RUN_NOT_COMPLETE_NOTE =
  "Turn 上的 Task/Run 只是编排 Agent 的受治理引用，不是生成工作流的执行，也不表示目标 Task/Run 完成。";
export const DRAFT_CANVAS_NOTE =
  "打开画布继续编辑未发布草稿。发布后 Runtime 只执行已发布版本；确认对话不会启动生成出的工作流。";
export const DRAFT_CANVAS_UNAVAILABLE_NOTE =
  "草稿已落地，但会话未返回 workflowId，无法跳到画布。未发布草稿仍不会被 Runtime 执行。";
export const CANVAS_DRAFT_VERSION_SEGMENT = "draft";

export interface AuthoringProjectBinding {
  projectId?: string;
  source: "route" | "project-picker";
}

export function isWorkflowAuthoringHash(hash: string): boolean {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  const queryIndex = trimmed.indexOf("?");
  if (queryIndex < 0) {
    return false;
  }
  const path = trimmed.slice(0, queryIndex);
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized !== "/workflows") {
    return false;
  }
  return new URLSearchParams(trimmed.slice(queryIndex + 1)).get(AUTHORING_QUERY) === "1";
}

export function resolveAuthoringProjectBinding(
  params: Record<string, string> = {},
  path = "",
  hash = "",
): AuthoringProjectBinding {
  const candidate = [params.projectId, queryProjectId(path), queryProjectId(hash)]
    .map((value) => value?.trim())
    .find((value): value is string => Boolean(value));
  return candidate ? { projectId: candidate, source: "route" } : { source: "project-picker" };
}

export function isAuthoringSessionBoundToProject(
  session: Pick<AuthoringSessionViewDto, "projectId"> | null | undefined,
  projectId: string,
): boolean {
  return Boolean(projectId.trim()) && session?.projectId === projectId.trim();
}

export function newAuthoringId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random()}`;
  return `${prefix}_${id}`;
}

export function writeCommandOptions(ifMatch?: number): CommandOptions {
  const options: CommandOptions = {
    idempotencyKey: newAuthoringId("idem"),
    operationId: newAuthoringId("op"),
  };
  if (ifMatch !== undefined) {
    options.ifMatch = ifMatch;
  }
  return options;
}

export function activeAuthoringTurn(
  session: Pick<AuthoringSessionViewDto, "turns"> | null | undefined,
): AuthoringTurnDto | undefined {
  return session?.turns.at(-1);
}

export function turnStatusLabel(status: AuthoringTurnDto["status"]): string {
  switch (status) {
    case "accepted":
      return "已接收";
    case "running":
      return "生成中";
    case "awaiting_confirmation":
      return "待确认";
    case "completed":
      return "已确认";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "closed":
      return "已关闭";
  }
}

export function canCancelAuthoringTurn(status: AuthoringTurnDto["status"]): boolean {
  return status === "accepted" || status === "running";
}

export function canRetryAuthoringTurn(status: AuthoringTurnDto["status"]): boolean {
  return status === "failed" || status === "cancelled";
}

/**
 * The current desktop-client contract exposes close on a Turn. Keep the
 * renderer action limited to terminal turns so a close cannot silently skip
 * cancellation of an in-flight Runtime operation.
 */
export function canCloseAuthoringTurn(status: AuthoringTurnDto["status"]): boolean {
  return (
    status === "awaiting_confirmation" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  );
}

export function sessionStatusLabel(status: AuthoringSessionViewDto["status"]): string {
  switch (status) {
    case "open":
      return "进行中";
    case "failed":
      return "会话失败";
    case "closed":
      return "已关闭";
  }
}

export function isUnavailableMessage(content: string): boolean {
  return content === "[message unavailable after restart]";
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "请求 Daemon 失败。输入未自动改写或伪造成成功。";
}

export function projectLabel(project: Pick<ProjectDto, "id" | "name">): string {
  return `${project.name} · ${project.id}`;
}

export function isEmptyAuthoringIntent(content: string): boolean {
  return content.trim().length === 0;
}

export type LandedAuthoringDraft = Extract<
  AuthoringSessionViewDto["draft"],
  { kind: "landed" }
>;
export type ProposalAuthoringDraft = Extract<
  AuthoringSessionViewDto["draft"],
  { kind: "proposal" }
>;

export function landedDraftCanvasPath(draft: LandedAuthoringDraft): string | null {
  const workflowId = draft.workflowId?.trim();
  return workflowId ? `/workflows/${workflowId}/versions/${CANVAS_DRAFT_VERSION_SEGMENT}` : null;
}

export function authoringTurnRefsNote(turn: AuthoringTurnDto): string | null {
  const parts: string[] = [];
  if (turn.refs.taskId) {
    parts.push(`Task ${turn.refs.taskId}`);
  }
  if (turn.refs.runId) {
    parts.push(`Run ${turn.refs.runId}`);
  }
  if (turn.refs.changeSetId) {
    parts.push(`ChangeSet ${turn.refs.changeSetId}`);
  }
  if (turn.refs.workflowDraftId) {
    parts.push(`草稿 ${turn.refs.workflowDraftId}`);
  }
  if (parts.length === 0) {
    return null;
  }
  return `引用：${parts.join(" · ")}。这些不是目标工作流已执行，也不表示 Task/Run 完成。`;
}

export function proposalWorkflowName(draft: ProposalAuthoringDraft): string {
  return draft.workflow?.name?.trim() || "服务端提案（详情引用由 Daemon 管理）";
}

export function proposalGraphNodeCount(draft: ProposalAuthoringDraft): number {
  const graph = draft.workflow?.graph;
  return graph?.nodes?.length ?? graph?.steps?.length ?? 0;
}

export function proposalTeamSummary(draft: ProposalAuthoringDraft): string | null {
  if (!draft.team) {
    return null;
  }
  const name = draft.team.name?.trim() || "Team 草稿";
  const count = draft.team.members?.length ?? 0;
  return `${name} · ${count} 名成员（未发布，不会开始规划）`;
}

export function sessionStatusTone(
  status: AuthoringSessionViewDto["status"],
): "success" | "warning" | "muted" {
  switch (status) {
    case "open":
      return "success";
    case "failed":
      return "warning";
    case "closed":
      return "muted";
  }
}

export function turnStatusTone(
  status: AuthoringTurnDto["status"],
): "info" | "warning" | "muted" | "danger" {
  switch (status) {
    case "accepted":
    case "running":
      return "info";
    case "awaiting_confirmation":
      return "warning";
    case "failed":
      return "danger";
    case "completed":
    case "cancelled":
    case "closed":
      return "muted";
  }
}

function queryProjectId(value: string): string | undefined {
  const queryIndex = value.indexOf("?");
  if (queryIndex < 0) {
    return undefined;
  }
  const query = value.slice(queryIndex + 1).split("#", 1)[0] ?? "";
  return new URLSearchParams(query).get("projectId") ?? undefined;
}
