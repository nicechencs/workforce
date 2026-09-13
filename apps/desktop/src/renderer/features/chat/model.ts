import { ProblemError, type CommandOptions } from "@workforce/desktop-client";
import {
  PROJECT_PROGRESS_NO_RECORDS_MESSAGE,
  type ChatClassifyResultDto,
  type ChatIntentDto,
  type ProjectProgressProjectionDto,
} from "@workforce/protocol";
import { ROLE_LIBRARY_PATH } from "@workforce/ui";

export const CHAT_SUBTITLE =
  "全局语言入口，任意页面可开，不限于作者页。分类不是完成；完成只看 Artifact / Run / Approval。";

export const CHAT_NOT_AUTHORING_ONLY =
  "这不是 /workflows?authoring=1 的作者页。创建流程仍走项目内 AuthoringSession；创建角色确认后进角色库草稿。";

export const CHAT_NOT_IM =
  "没有 Worker 收件箱，也没有无项目聊天室。对象仍是 WorkerVersion / Workflow / Task / Run / Artifact。";

export const DIRECT_UNSUPPORTED_NOTE =
  "「去做 / 现在改这个 bug」在 direct 未就绪时是 unsupported_capability，不会渲染成已在跑。";

export const CREATE_WORKER_PROPOSAL_NOTE =
  "这是创建角色提案，不是已发布员工。确认后才会在库中落下未发布草稿。";

export const CREATE_WORKER_LANDED_NOTE =
  "库中已有未发布角色草稿。未发布不能当 Team 成员引用，也不会开始执行。";

export const CREATE_WORKFLOW_NEEDS_PROJECT =
  "创建流程必须先选择项目，才会打开 AuthoringSession。未发布草稿不会被 Runtime 执行。";

export const CREATE_WORKFLOW_PROPOSAL_NOTE =
  "AuthoringSession 返回了待确认提案。确认只会落地未发布 WorkflowDraft，不会发布或执行。";

export const CREATE_WORKFLOW_LANDED_NOTE =
  "未发布工作流草稿已落地。打开画布继续编辑；确认对话不会启动该流程。";

export const PROGRESS_FACT_NOTE =
  "只渲染 Daemon 投影里的 Task / Run / Event / Artifact。没有记录就说还没有。";

export const DISCUSS_NEEDS_PROJECT = "交流工作必须先选择项目。没有项目边界不会发写。";

export const DISCUSS_NEEDS_RUN =
  "针对执行中的工作需要挂 runId，才会调用已有 POST /runs/{id}:input。没有挂点不发写。";

export const DISCUSS_SENT_NOTE = "已把内容发给当前 Run 的 input。这不是 Task/Run 完成。";

export const TURN_CONFIRMED_IS_NOT_DONE =
  "Authoring Turn 确认只表示草稿落地，不是目标 Task/Run 完成，也不是已在执行。";

export const CANVAS_DRAFT_VERSION_SEGMENT = "draft";

export const DUTY_LABELS = ["planner", "developer", "reviewer"] as const;

export type DutyLabel = (typeof DUTY_LABELS)[number] | "worker";

export interface WorkerProposalWrite {
  name: string;
  role: DutyLabel;
  description: string;
}

export interface LandedWorkflowDraft {
  workflowDraftId?: string;
  workflowId?: string;
  revision?: number;
  unpublished: true;
}

export function newChatId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random()}`;
  return `${prefix}_${id}`;
}

export function writeCommandOptions(ifMatch?: number): CommandOptions {
  const options: CommandOptions = {
    idempotencyKey: newChatId("idem"),
    operationId: newChatId("op"),
  };
  if (ifMatch !== undefined) {
    options.ifMatch = ifMatch;
  }
  return options;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ProblemError) {
    const code = error.problem.code;
    const detail = error.problem.detail || error.problem.title;
    return code ? `${code}：${detail}` : detail;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return "请求 Daemon 失败。输入未改写，也没有伪造成成功。";
}

export function errorCode(error: unknown): string | undefined {
  if (error instanceof ProblemError) {
    return error.problem.code;
  }
  return undefined;
}

export function isEmptyChatIntent(content: string): boolean {
  return content.trim().length === 0;
}

export function intentKindLabel(kind: ChatIntentDto["kind"]): string {
  switch (kind) {
    case "create_worker":
      return "创建角色";
    case "create_workflow":
      return "创建流程";
    case "query_progress":
      return "询问进度";
    case "discuss_work":
      return "交流工作";
  }
}

export function workerWriteFromText(text: string): WorkerProposalWrite {
  const description = text.trim();
  const stripped = description
    .replace(/^(?:创建角色|创建员工|新角色|角色版本|create worker)\s*[:：]?\s*/i, "")
    .trim();
  const role = detectDuty(description) ?? detectDuty(stripped) ?? "worker";
  const nameSource = stripped.length > 0 ? stripped : description;
  const name = truncateName(nameSource) || "Untitled worker";
  return { name, role, description: description || name };
}

function detectDuty(text: string): DutyLabel | undefined {
  const lowered = text.toLowerCase();
  if (/\bplanner\b|规划/.test(lowered)) {
    return "planner";
  }
  if (/\bdeveloper\b|开发|实现/.test(lowered)) {
    return "developer";
  }
  if (/\breviewer\b|审查|评审/.test(lowered)) {
    return "reviewer";
  }
  return undefined;
}

function truncateName(value: string): string {
  const firstLine = value.split(/\r?\n/, 1)[0]?.trim() ?? "";
  if (firstLine.length <= 120) {
    return firstLine;
  }
  return firstLine.slice(0, 120).trim();
}

export function roleLibraryPath(): string {
  return ROLE_LIBRARY_PATH;
}

export function landedDraftCanvasPath(draft: LandedWorkflowDraft): string | null {
  const workflowId = draft.workflowId?.trim();
  return workflowId ? `/workflows/${workflowId}/versions/${CANVAS_DRAFT_VERSION_SEGMENT}` : null;
}

export function progressEmptyMessage(
  projection: Pick<ProjectProgressProjectionDto, "empty" | "emptyDisplay">,
): string {
  if (!projection.empty) {
    return "";
  }
  return projection.emptyDisplay ?? PROJECT_PROGRESS_NO_RECORDS_MESSAGE;
}

export function hasCompletionFact(projection: ProjectProgressProjectionDto): boolean {
  return projection.artifacts.length > 0;
}

export const TERMINAL_RUN_STATUSES = new Set(["succeeded", "failed", "timed_out", "cancelled"]);

export function isActiveRun(status: string): boolean {
  return !TERMINAL_RUN_STATUSES.has(status);
}

export function classifyUnsupportedAction(
  result: ChatClassifyResultDto,
): "direct" | "im" | undefined {
  return result.outcome === "unsupported" ? result.action : undefined;
}

export function isDirectCapabilityReady(direct: boolean | undefined): boolean {
  return direct === true;
}
