import type {
  AuthoringDraftDto,
  AuthoringSessionDto,
  AuthoringSessionMessageDto,
  CommandOptions,
  CreateTeamInput,
  CreateWorkflowInput,
  CreateWorkflowVersionInput,
  TeamDto,
  WorkflowDto,
  WorkflowGraphEdgeDto,
  WorkflowGraphNodeDto,
  WorkflowStepDto,
  WorkflowVersionDto,
} from "@workforce/desktop-client";

import { DESKTOP_LOCAL_AUTHORING_PROJECT_ID } from "./session-store.js";

export type { AuthoringDraftDto, AuthoringSessionDto, AuthoringSessionMessageDto };

/**
 * User-append + Desktop-local session store are wired. This flag does **not**
 * mean an authoring Agent / LLM loop exists. Daemon chat path stays absent.
 */
export const CHAT_SESSION_PROTOCOL_FROZEN = true;

export const CHAT_SESSION_GAP =
  "Desktop-local / in-process 会话存储已接线：用户消息按 AppendAuthoringSessionMessageInput 追加，对照已冻结 AuthoringSessionDto / AuthoringDraftDto；快照写入本机 localStorage，跨 renderer reload 仍可恢复。能力矩阵仍不列 chat endpoint / Daemon chat 资源。编排 Agent 回复仍 planned，禁止把假回复渲染成生成成功。";

export const AGENT_REPLY_GAP =
  "编排 Agent 回复仍 planned。本页不会生成或渲染假装成功的 Agent 气泡，用户消息也不是 Task/Run 完成。";

export const AUTHORING_ROUTE_GAP =
  "T11 路由表与 FEATURE_SLOTS 没有预留 workflow-authoring slot。本特征可导入，由工作流页用 ?authoring=1 挂入，不改 catalog.ts。";

export const DRAFT_NOT_RUNTIME_NOTE =
  "落库的是未发布 WorkflowDefinition / WorkflowVersion。未发布图不得执行，对话也不是 Runtime。";

export const CANVAS_ROUTE_NOTE =
  "T18 画布路由已在 main：未发布 version 走 /workflows/:id/versions/:versionId。这里不实现画布，只深链已有作者面。";

export const AUTHORING_QUERY = "authoring";
export const AUTHORING_PATH = "/workflows?authoring=1";

export const WORKER_ROLES = ["planner", "developer", "reviewer", "approver"] as const;
export type AuthoringWorkerRole = (typeof WORKER_ROLES)[number];

export type AuthoringFormField =
  "name" | "description" | "rolesText" | "stepsText" | "intentText" | "teamName";

export interface AuthoringForm {
  name: string;
  description: string;
  rolesText: string;
  stepsText: string;
  intentText: string;
  teamName: string;
}

export type AuthoringPhase =
  "idle" | "empty_intent" | "validation_failed" | "submitting" | "landed" | "failed";

export interface CanvasLink {
  available: boolean;
  href: string;
  reason: string;
}

export interface LandedDraft {
  workflowId: string;
  workflowName: string;
  versionId: string;
  status: "draft";
  unpublished: true;
  teamId?: string;
  teamWarning?: string;
  catalogHref: string;
  canvas: CanvasLink;
}

export interface AuthoringChatState {
  enabled: true;
  submitEnabled: boolean;
  explanation: string;
  agentReplyPlanned: true;
  sessionId: string | null;
  projectId: string;
  messages: readonly AuthoringSessionMessageDto[];
  draft: AuthoringDraftDto | undefined;
}

export interface AuthoringViewModel {
  form: AuthoringForm;
  phase: AuthoringPhase;
  error: string | null;
  chat: AuthoringChatState;
  draft: LandedDraft | null;
  routeGap: string;
  note: string;
}

export type AuthoringAction =
  | { type: "change"; field: AuthoringFormField; value: string }
  | { type: "hydrate"; form: Partial<AuthoringForm> }
  | { type: "sessionHydrated"; session: AuthoringSessionDto }
  | { type: "sessionUpdated"; session: AuthoringSessionDto; clearIntent?: boolean }
  | { type: "submitChat" }
  | { type: "submitDraft" }
  | { type: "appendFailed"; error: unknown }
  | { type: "failure"; error: unknown }
  | { type: "landed"; draft: LandedDraft };

export interface AuthoringWriteClient {
  createWorkflow(input: CreateWorkflowInput, options: CommandOptions): Promise<WorkflowDto>;
  createWorkflowVersion(
    id: string,
    input: CreateWorkflowVersionInput,
    options: CommandOptions,
  ): Promise<WorkflowVersionDto>;
  createTeam?(input: CreateTeamInput, options: CommandOptions): Promise<TeamDto>;
}

export interface StructuredIntent {
  name: string;
  description: string;
  teamName?: string;
  graph: CreateWorkflowVersionInput;
}

export type IntentParseResult =
  | { ok: true; intent: StructuredIntent }
  | { ok: false; code: "empty_intent" | "validation_failed"; reason: string };

export const emptyAuthoringForm: AuthoringForm = {
  name: "",
  description: "",
  rolesText: "",
  stepsText: "",
  intentText: "",
  teamName: "",
};

export function emptyAuthoringChat(projectId?: string): AuthoringChatState {
  return {
    enabled: true,
    submitEnabled: false,
    explanation: CHAT_SESSION_GAP,
    agentReplyPlanned: true,
    sessionId: null,
    projectId: projectId?.trim() || DESKTOP_LOCAL_AUTHORING_PROJECT_ID,
    messages: [],
    draft: undefined,
  };
}

export function chatFromSession(session: AuthoringSessionDto, intentText = ""): AuthoringChatState {
  return {
    enabled: true,
    submitEnabled: intentText.trim().length > 0,
    explanation: CHAT_SESSION_GAP,
    agentReplyPlanned: true,
    sessionId: session.id,
    projectId: session.projectId,
    messages: session.messages,
    draft: session.draft,
  };
}

export function emptyAuthoringModel(): AuthoringViewModel {
  return {
    form: { ...emptyAuthoringForm },
    phase: "idle",
    error: null,
    chat: emptyAuthoringChat(),
    draft: null,
    routeGap: AUTHORING_ROUTE_GAP,
    note: DRAFT_NOT_RUNTIME_NOTE,
  };
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

export function catalogDraftPath(workflowId: string): string {
  return `/workflows/${workflowId}`;
}

export function canvasEditLink(workflowId: string, versionId: string): CanvasLink {
  return {
    available: true,
    href: `/workflows/${workflowId}/versions/${versionId}`,
    reason: CANVAS_ROUTE_NOTE,
  };
}

export function rejectAgentGeneration(): { ok: false; reason: string } {
  return { ok: false, reason: AGENT_REPLY_GAP };
}

/** Agent generation stays rejected. User-only append is a separate path. */
export function rejectChatSubmit(): { ok: false; reason: string } {
  return rejectAgentGeneration();
}

export function canAppendUserMessage(state: AuthoringViewModel):
  | {
      ok: true;
      content: string;
      sessionId: string;
    }
  | { ok: false; reason: string; code: "empty_intent" | "session_missing" } {
  const content = state.form.intentText.trim();
  if (content.length === 0) {
    return {
      ok: false,
      code: "empty_intent",
      reason: "请先写下要追加到本机会话的用户消息。编排 Agent 不会自动回复。",
    };
  }
  if (!state.chat.sessionId) {
    return {
      ok: false,
      code: "session_missing",
      reason: "本机会话尚未建立。已保留你的输入，没有编造 Agent 回复。",
    };
  }
  return { ok: true, content, sessionId: state.chat.sessionId };
}

export function parseStructuredIntent(form: AuthoringForm): IntentParseResult {
  const name = form.name.trim();
  const description = form.description.trim();
  const teamName = form.teamName.trim();
  const steps = splitLines(form.stepsText);
  const roles = splitLines(form.rolesText).map(mapWorkerRole);
  if (name.length === 0) {
    const hasFreeText = form.intentText.trim().length > 0;
    return {
      ok: false,
      code: hasFreeText ? "empty_intent" : "validation_failed",
      reason: hasFreeText
        ? "只有自由文本、没有可落库的工作流名称。编排 Agent 尚未接线，不能把这段文字当成 Agent 已生成的草稿。你可以把这段文字追加为本机会话中的用户消息。"
        : "请填写工作流名称后再写入未发布草稿。",
    };
  }
  return {
    ok: true,
    intent: {
      name,
      description,
      ...(teamName.length > 0 ? { teamName } : {}),
      graph: buildDraftGraph(steps, roles),
    },
  };
}

export function buildDraftGraph(
  stepTitles: string[],
  roles: Array<AuthoringWorkerRole | undefined>,
): CreateWorkflowVersionInput {
  const nodes: WorkflowGraphNodeDto[] = [];
  const steps: WorkflowStepDto[] = [];
  const edges: WorkflowGraphEdgeDto[] = [];
  for (let index = 0; index < stepTitles.length; index += 1) {
    const title = stepTitles[index] ?? `步骤 ${index + 1}`;
    const id = `step_${index + 1}`;
    const role = roles[index];
    const node: WorkflowGraphNodeDto = { id, kind: "task", title };
    if (role) {
      node.role = role;
    }
    nodes.push(node);
    const step: WorkflowStepDto = { id, kind: "task", title, notes: [] };
    if (role) {
      step.worker = role;
    }
    steps.push(step);
    if (index > 0) {
      edges.push({
        id: `edge_${index}`,
        from: `step_${index}`,
        to: id,
        waitFor: "outputs_ready",
      });
    }
  }
  const graph: CreateWorkflowVersionInput = {};
  if (nodes.length > 0) {
    graph.entry = nodes[0]?.id;
    graph.nodes = nodes;
    graph.edges = edges;
    graph.steps = steps;
  }
  return graph;
}

export function reduceAuthoring(
  state: AuthoringViewModel,
  action: AuthoringAction,
): AuthoringViewModel {
  switch (action.type) {
    case "change": {
      const form = { ...state.form, [action.field]: action.value };
      return {
        ...state,
        form,
        phase:
          state.phase === "submitting"
            ? "submitting"
            : state.phase === "landed"
              ? "idle"
              : state.phase,
        chat: withComposer(state.chat, form.intentText),
      };
    }
    case "hydrate": {
      const form = { ...state.form, ...action.form };
      return {
        ...state,
        form,
        chat: withComposer(state.chat, form.intentText),
      };
    }
    case "sessionHydrated":
      return {
        ...state,
        chat: chatFromSession(action.session, state.form.intentText),
      };
    case "sessionUpdated":
      return {
        ...state,
        form: action.clearIntent ? { ...state.form, intentText: "" } : state.form,
        error: action.clearIntent ? null : state.error,
        chat: chatFromSession(action.session, action.clearIntent ? "" : state.form.intentText),
      };
    case "submitChat": {
      const appended = canAppendUserMessage(state);
      if (!appended.ok) {
        return {
          ...state,
          phase: appended.code === "empty_intent" ? "empty_intent" : "failed",
          error: appended.reason,
          chat: withComposer(state.chat, state.form.intentText),
        };
      }
      return {
        ...state,
        phase: state.phase === "landed" ? "landed" : "idle",
        error: null,
        chat: withComposer(state.chat, appended.content),
      };
    }
    case "submitDraft": {
      const parsed = parseStructuredIntent(state.form);
      if (!parsed.ok) {
        return {
          ...state,
          phase: parsed.code,
          error: parsed.reason,
          draft: null,
          chat: withComposer(state.chat, state.form.intentText),
        };
      }
      return {
        ...state,
        phase: "submitting",
        error: null,
        chat: withComposer(state.chat, state.form.intentText),
      };
    }
    case "appendFailed":
      return {
        ...state,
        phase: "failed",
        error: errorMessage(action.error),
        chat: withComposer(state.chat, state.form.intentText),
      };
    case "failure":
      return {
        ...state,
        phase: "failed",
        error: errorMessage(action.error),
        draft: null,
        chat: withComposer(state.chat, state.form.intentText),
      };
    case "landed":
      return {
        ...state,
        phase: "landed",
        error: null,
        draft: action.draft,
        chat: withComposer(state.chat, state.form.intentText),
      };
  }
}

function withComposer(chat: AuthoringChatState, intentText: string): AuthoringChatState {
  return {
    ...chat,
    submitEnabled: intentText.trim().length > 0 && chat.sessionId !== null,
  };
}

export function proposalDraftFromForm(form: AuthoringForm): AuthoringDraftDto | undefined {
  const parsed = parseStructuredIntent(form);
  if (!parsed.ok) {
    return undefined;
  }
  const workflow: NonNullable<Extract<AuthoringDraftDto, { kind: "proposal" }>["workflow"]> = {
    name: parsed.intent.name,
  };
  if (parsed.intent.description.length > 0) {
    workflow.description = parsed.intent.description;
  }
  if (
    parsed.intent.graph.nodes !== undefined ||
    parsed.intent.graph.steps !== undefined ||
    parsed.intent.graph.entry !== undefined
  ) {
    workflow.graph = parsed.intent.graph;
  }
  const draft: AuthoringDraftDto = {
    kind: "proposal",
    unpublished: true,
    workflow,
  };
  if (parsed.intent.teamName) {
    draft.team = { name: parsed.intent.teamName };
  }
  return draft;
}

export function landedDraftProjection(draft: LandedDraft): AuthoringDraftDto {
  return {
    kind: "landed",
    unpublished: true,
    workflowId: draft.workflowId,
    workflowVersionId: draft.versionId,
    ...(draft.teamId ? { teamId: draft.teamId } : {}),
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "写入未发布草稿失败。已保留你的输入，没有回退夹具冒充生成成功。";
}

export function newAuthoringId(prefix: string): string {
  const bytes = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random()}`;
  return `${prefix}_${bytes}`;
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

export async function landUnpublishedDraft(
  client: AuthoringWriteClient,
  form: AuthoringForm,
): Promise<LandedDraft> {
  const parsed = parseStructuredIntent(form);
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  const workflow = await client.createWorkflow(
    {
      name: parsed.intent.name,
      ...(parsed.intent.description.length > 0 ? { description: parsed.intent.description } : {}),
    },
    writeCommandOptions(),
  );
  if (workflow.status === "published") {
    throw new Error("写入结果不是未发布草稿；拒绝把它当成对话生成成功。");
  }
  const revision = workflow.stateRevision;
  const version = await client.createWorkflowVersion(
    workflow.id,
    parsed.intent.graph,
    writeCommandOptions(revision),
  );
  if (version.status !== "draft" || version.immutable) {
    throw new Error("版本不是未发布草稿；拒绝发布或执行。");
  }
  const draft: LandedDraft = {
    workflowId: workflow.id,
    workflowName: workflow.name,
    versionId: version.id,
    status: "draft",
    unpublished: true,
    catalogHref: catalogDraftPath(workflow.id),
    canvas: canvasEditLink(workflow.id, version.id),
  };
  const teamName = parsed.intent.teamName;
  if (teamName && client.createTeam) {
    try {
      const team = await client.createTeam({ name: teamName }, writeCommandOptions());
      draft.teamId = team.id;
    } catch (error) {
      draft.teamWarning = `工作流草稿已写入，可选 Team 草稿失败：${errorMessage(error)}`;
    }
  }
  return draft;
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function mapWorkerRole(value: string): AuthoringWorkerRole | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "planner" || normalized.includes("规划")) {
    return "planner";
  }
  if (normalized === "developer" || normalized.includes("开发") || normalized.includes("实现")) {
    return "developer";
  }
  if (normalized === "reviewer" || normalized.includes("审查")) {
    return "reviewer";
  }
  if (normalized === "approver" || normalized.includes("审批")) {
    return "approver";
  }
  if ((WORKER_ROLES as readonly string[]).includes(normalized)) {
    return normalized as AuthoringWorkerRole;
  }
  return undefined;
}
