import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  AuthoringSessionViewDto,
  AuthoringTurnDto,
  ProjectDto,
} from "@workforce/desktop-client";

import type { FeaturePageProps } from "../contract.js";
import { useWorkforceClient } from "../hooks.js";
import {
  badgeStyle,
  buttonStyle,
  cardStyle,
  errorStyle,
  inputStyle,
  labelStyle,
  mutedStyle,
  pageStyle,
  titleStyle,
  warningStyle,
} from "../projects/ui.js";
import {
  AGENT_REPLY_GAP,
  AUTHORING_PROPOSAL_PREVIEW_NOTE,
  AUTHORING_ROUTE_GAP,
  DRAFT_NOT_RUNTIME_NOTE,
  activeAuthoringTurn,
  canCancelAuthoringTurn,
  canCloseAuthoringTurn,
  canRetryAuthoringTurn,
  errorMessage,
  isAuthoringSessionBoundToProject,
  isUnavailableMessage,
  projectLabel,
  resolveAuthoringProjectBinding,
  sessionStatusLabel,
  turnStatusLabel,
  writeCommandOptions,
} from "./model.js";

type BusyAction =
  "loading" | "sending" | "confirming" | "cancelling" | "retrying" | "closing" | null;

export function WorkflowAuthoringPage(props: FeaturePageProps): ReactNode {
  const client = useWorkforceClient();
  const binding = resolveAuthoringProjectBinding(props.params, props.path, currentHash());
  const routeProjectId = binding.projectId;
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [projectId, setProjectId] = useState(routeProjectId ?? "");
  const [projectsLoading, setProjectsLoading] = useState(!routeProjectId);
  const [session, setSession] = useState<AuthoringSessionViewDto | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const boundProjectRef = useRef(projectId);

  boundProjectRef.current = projectId;

  useEffect(() => {
    if (routeProjectId) {
      setProjectId(routeProjectId);
      setProjectsLoading(false);
      return;
    }
    let cancelled = false;
    setProjectsLoading(true);
    void client
      .listProjects({ limit: 100 })
      .then((page) => {
        if (cancelled) {
          return;
        }
        setProjects(page.items);
        setProjectId((current) => current || page.items[0]?.id || "");
        setProjectsLoading(false);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setProjectsLoading(false);
          setError(errorMessage(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, routeProjectId]);

  useEffect(() => {
    if (!projectId) {
      setSession(null);
      setBusy(null);
      return;
    }
    let cancelled = false;
    setSession(null);
    setError(null);
    setBusy("loading");
    void loadOrCreateSession(client, projectId)
      .then((loaded) => {
        if (cancelled || !isAuthoringSessionBoundToProject(loaded, projectId)) {
          return;
        }
        setSession(loaded);
        setBusy(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setBusy(null);
          setError(errorMessage(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, projectId]);

  async function refreshUntilSettled(
    sessionId: string,
    turnId: string,
    isDone: (status: AuthoringTurnDto["status"]) => boolean = isSettledTurn,
  ): Promise<void> {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const next = await client.getAuthoringSession(sessionId);
      if (!isAuthoringSessionBoundToProject(next, boundProjectRef.current)) {
        throw new Error("Daemon 返回了不属于当前项目的作者会话，已拒绝显示。");
      }
      setSession(next);
      const turn = next.turns.find((item) => item.id === turnId);
      if (turn && isDone(turn.status)) {
        return;
      }
      await wait(250);
    }
  }

  async function onSend(): Promise<void> {
    const current = session;
    const content = input.trim();
    if (!current || current.status !== "open" || !content || busy !== null) {
      return;
    }
    setBusy("sending");
    setError(null);
    try {
      const accepted = await client.sendAuthoringMessage(
        current.id,
        content,
        writeCommandOptions(current.stateRevision),
      );
      setInput("");
      await refreshUntilSettled(current.id, accepted.turnId);
      setBusy(null);
    } catch (reason: unknown) {
      setBusy(null);
      setError(errorMessage(reason));
    }
  }

  async function onConfirm(): Promise<void> {
    const current = session;
    const turn = activeAuthoringTurn(current);
    if (!current || !turn || turn.status !== "awaiting_confirmation" || busy !== null) {
      return;
    }
    setBusy("confirming");
    setError(null);
    try {
      const accepted = await client.confirmAuthoringTurn(
        current.id,
        turn.id,
        writeCommandOptions(turn.revision),
      );
      await refreshUntilSettled(current.id, accepted.turnId);
      setBusy(null);
    } catch (reason: unknown) {
      setBusy(null);
      setError(errorMessage(reason));
    }
  }

  async function onCancel(): Promise<void> {
    const current = session;
    const turn = activeAuthoringTurn(current);
    if (!current || !turn || !canCancelAuthoringTurn(turn.status) || busy !== null) {
      return;
    }
    setBusy("cancelling");
    setError(null);
    try {
      const accepted = await client.cancelAuthoringTurn(
        current.id,
        turn.id,
        writeCommandOptions(turn.revision),
      );
      await refreshUntilSettled(
        current.id,
        accepted.turnId,
        (status) => status === "cancelled" || status === "failed",
      );
      setBusy(null);
    } catch (reason: unknown) {
      setBusy(null);
      setError(errorMessage(reason));
    }
  }

  async function onRetry(): Promise<void> {
    const current = session;
    const turn = activeAuthoringTurn(current);
    if (!current || !turn || !canRetryAuthoringTurn(turn.status) || busy !== null) {
      return;
    }
    setBusy("retrying");
    setError(null);
    try {
      const accepted = await client.retryAuthoringTurn(
        current.id,
        turn.id,
        writeCommandOptions(turn.revision),
      );
      await refreshUntilSettled(current.id, accepted.turnId);
      setBusy(null);
    } catch (reason: unknown) {
      setBusy(null);
      setError(errorMessage(reason));
    }
  }

  async function onClose(): Promise<void> {
    const current = session;
    const turn = activeAuthoringTurn(current);
    if (!current || !turn || !canCloseAuthoringTurn(turn.status) || busy !== null) {
      return;
    }
    setBusy("closing");
    setError(null);
    try {
      const accepted = await client.closeAuthoringTurn(
        current.id,
        turn.id,
        writeCommandOptions(turn.revision),
      );
      await refreshUntilSettled(current.id, accepted.turnId, (status) => status === "closed");
      setBusy(null);
    } catch (reason: unknown) {
      setBusy(null);
      setError(errorMessage(reason));
    }
  }

  function onProjectChange(nextProjectId: string): void {
    if (nextProjectId === projectId) {
      return;
    }
    setProjectId(nextProjectId);
    setSession(null);
    setInput("");
    setError(null);
  }

  const turn = activeAuthoringTurn(session);
  const sessionReady = session !== null && isAuthoringSessionBoundToProject(session, projectId);
  const sendDisabled =
    !sessionReady || session.status !== "open" || busy !== null || input.trim().length === 0;
  const confirmDisabled =
    !sessionReady || turn?.status !== "awaiting_confirmation" || busy !== null;

  return (
    <main style={pageStyle} data-testid="workflow-authoring-page">
      <p>
        <button
          type="button"
          style={buttonStyle("secondary")}
          onClick={() => props.navigate("/workflows")}
        >
          返回工作流目录
        </button>
      </p>
      <h1 style={titleStyle}>对话生成工作流</h1>
      <p style={mutedStyle}>{AUTHORING_ROUTE_GAP}</p>
      <ProjectPicker
        projects={projects}
        selectedProjectId={projectId}
        {...(routeProjectId ? { routeProjectId } : {})}
        loading={projectsLoading}
        onChange={onProjectChange}
      />
      {sessionReady ? (
        <>
          <SessionSummary
            session={session}
            turn={turn}
            busy={busy}
            onCancel={onCancel}
            onRetry={onRetry}
            onClose={onClose}
          />
          <ConversationPanel
            session={session}
            input={input}
            disabled={sendDisabled}
            busy={busy}
            onChange={setInput}
            onSend={onSend}
          />
          {session.draft?.kind === "proposal" && turn?.status === "awaiting_confirmation" ? (
            <ProposalDraftPreview
              draft={session.draft}
              turn={turn}
              onConfirm={onConfirm}
              disabled={confirmDisabled}
            />
          ) : null}
          {session.draft?.kind === "landed" ? <LandedDraftCard draft={session.draft} /> : null}
        </>
      ) : (
        <section style={cardStyle} data-testid="workflow-authoring-session-loading">
          <p style={mutedStyle}>
            {projectId
              ? busy === "loading"
                ? "正在加载项目作者会话…"
                : "尚未建立项目作者会话。"
              : "请选择项目后开始聊天。"}
          </p>
        </section>
      )}
      <p style={mutedStyle} data-testid="workflow-authoring-chat-note">
        {AGENT_REPLY_GAP}
      </p>
      {error ? (
        <div style={errorStyle} data-testid="workflow-authoring-error">
          {error}
        </div>
      ) : null}
    </main>
  );
}

function ProjectPicker(props: {
  projects: readonly ProjectDto[];
  selectedProjectId: string;
  routeProjectId?: string;
  loading: boolean;
  onChange: (projectId: string) => void;
}): ReactNode {
  if (props.routeProjectId) {
    return (
      <section style={cardStyle} data-testid="workflow-authoring-project">
        <span style={badgeStyle("muted")}>项目范围</span>
        <p style={mutedStyle}>当前项目：{props.routeProjectId}</p>
      </section>
    );
  }
  return (
    <section style={cardStyle} data-testid="workflow-authoring-project-picker">
      <label style={labelStyle} htmlFor="workflow-authoring-project">
        选择项目
      </label>
      {props.loading ? <p style={mutedStyle}>正在加载项目…</p> : null}
      {!props.loading && props.projects.length === 0 ? (
        <p style={warningStyle}>没有可用项目。请先创建项目，再打开工作流作者面。</p>
      ) : null}
      {!props.loading && props.projects.length > 0 ? (
        <select
          id="workflow-authoring-project"
          data-testid="workflow-authoring-project-select"
          style={inputStyle}
          value={props.selectedProjectId}
          onChange={(event) => props.onChange(event.target.value)}
        >
          {props.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {projectLabel(project)}
            </option>
          ))}
        </select>
      ) : null}
    </section>
  );
}

function SessionSummary(props: {
  session: AuthoringSessionViewDto;
  turn: AuthoringTurnDto | undefined;
  busy: BusyAction;
  onCancel: () => void;
  onRetry: () => void;
  onClose: () => void;
}): ReactNode {
  return (
    <section style={cardStyle} data-testid="workflow-authoring-session-status">
      <div style={{ display: "flex", gap: "var(--wf-space-sm, 8px)", alignItems: "center" }}>
        <span style={badgeStyle(props.session.status === "open" ? "health" : "warning")}>
          会话 {sessionStatusLabel(props.session.status)}
        </span>
        {props.turn ? (
          <span
            style={badgeStyle(props.turn.status === "awaiting_confirmation" ? "warning" : "muted")}
          >
            Turn {turnStatusLabel(props.turn.status)}
          </span>
        ) : null}
        {props.busy ? <span style={mutedStyle}>{busyLabel(props.busy)}</span> : null}
      </div>
      <p style={mutedStyle} data-testid="workflow-authoring-session-id">
        会话 {props.session.id} · 项目 {props.session.projectId} · revision{" "}
        {props.session.stateRevision}
      </p>
      {props.turn ? (
        <div
          style={{ display: "flex", gap: "var(--wf-space-sm, 8px)", flexWrap: "wrap" }}
          data-testid="workflow-authoring-turn-actions"
        >
          {canCancelAuthoringTurn(props.turn.status) ? (
            <button
              type="button"
              data-testid="workflow-authoring-cancel"
              style={buttonStyle("secondary", props.busy !== null)}
              disabled={props.busy !== null}
              onClick={props.onCancel}
            >
              {props.busy === "cancelling" ? "取消中…" : "取消生成"}
            </button>
          ) : null}
          {canRetryAuthoringTurn(props.turn.status) ? (
            <button
              type="button"
              data-testid="workflow-authoring-retry"
              style={buttonStyle("secondary", props.busy !== null)}
              disabled={props.busy !== null}
              onClick={props.onRetry}
            >
              {props.busy === "retrying" ? "重试中…" : "重试生成"}
            </button>
          ) : null}
          {canCloseAuthoringTurn(props.turn.status) ? (
            <button
              type="button"
              data-testid="workflow-authoring-close"
              style={buttonStyle("secondary", props.busy !== null)}
              disabled={props.busy !== null}
              onClick={props.onClose}
            >
              {props.busy === "closing" ? "关闭中…" : "关闭当前会话"}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ConversationPanel(props: {
  session: AuthoringSessionViewDto;
  input: string;
  disabled: boolean;
  busy: BusyAction;
  onChange: (value: string) => void;
  onSend: () => void;
}): ReactNode {
  return (
    <section style={cardStyle} data-testid="workflow-authoring-chat">
      <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>工作流编排对话</h2>
      <MessageList messages={props.session.messages} />
      <label style={labelStyle} htmlFor="wf-authoring-intent">
        发送消息
      </label>
      <textarea
        id="wf-authoring-intent"
        data-testid="workflow-authoring-intent"
        style={{ ...inputStyle, minHeight: "96px" }}
        value={props.input}
        disabled={props.disabled && props.busy !== null}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder="例如：创建一个包含规划、实现和审查的工作流。"
      />
      <button
        type="button"
        data-testid="workflow-authoring-send-chat"
        style={buttonStyle("primary", props.disabled)}
        disabled={props.disabled}
        onClick={props.onSend}
      >
        {props.busy === "sending" ? "发送中…" : "发送消息"}
      </button>
    </section>
  );
}

function MessageList(props: {
  messages: readonly AuthoringSessionViewDto["messages"][number][];
}): ReactNode {
  if (props.messages.length === 0) {
    return (
      <p style={mutedStyle} data-testid="workflow-authoring-chat-empty">
        还没有消息。
      </p>
    );
  }
  return (
    <ul
      style={{ listStyle: "none", padding: 0, margin: "0 0 var(--wf-space-md, 12px)" }}
      data-testid="workflow-authoring-messages"
    >
      {props.messages.map((message) => (
        <li
          key={message.id}
          data-testid={`workflow-authoring-message-${message.role}`}
          style={{
            ...cardStyle,
            marginBottom: "var(--wf-space-sm, 8px)",
            background: "var(--wf-color-page, #e8edf2)",
          }}
        >
          <strong>
            {message.role === "user" ? "用户" : message.role === "system" ? "系统" : "编排 Agent"}
          </strong>
          {isUnavailableMessage(message.content) ? (
            <p style={warningStyle}>消息正文在 Daemon 重启后不可恢复，仅保留引用。</p>
          ) : (
            <p style={{ margin: "var(--wf-space-xs, 4px) 0 0" }}>{message.content}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function ProposalDraftPreview(props: {
  draft: Extract<AuthoringSessionViewDto["draft"], { kind: "proposal" }>;
  turn: AuthoringTurnDto;
  onConfirm: () => void;
  disabled: boolean;
}): ReactNode {
  const graph = props.draft.workflow?.graph;
  const nodeCount = graph?.nodes?.length ?? graph?.steps?.length ?? 0;
  return (
    <section style={cardStyle} data-testid="workflow-authoring-proposal-preview">
      <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>结构化提案待确认</h2>
      <p style={mutedStyle} data-testid="workflow-authoring-proposal-preview-note">
        {AUTHORING_PROPOSAL_PREVIEW_NOTE}
      </p>
      <p data-testid="workflow-authoring-proposal-name">
        工作流：{props.draft.workflow?.name ?? "服务端提案（详情引用由 Daemon 管理）"}
      </p>
      {props.draft.workflow?.description ? (
        <p style={mutedStyle}>{props.draft.workflow.description}</p>
      ) : null}
      <p style={mutedStyle} data-testid="workflow-authoring-proposal-graph">
        结构化节点：{nodeCount}
      </p>
      <button
        type="button"
        data-testid="workflow-authoring-confirm"
        style={buttonStyle("primary", props.disabled)}
        disabled={props.disabled}
        onClick={props.onConfirm}
      >
        {props.disabled ? "确认中…" : "确认并创建未发布草稿"}
      </button>
      <p style={mutedStyle}>
        Turn {props.turn.id} · revision {props.turn.revision}
      </p>
    </section>
  );
}

function LandedDraftCard(props: {
  draft: Extract<AuthoringSessionViewDto["draft"], { kind: "landed" }>;
}): ReactNode {
  return (
    <section style={cardStyle} data-testid="workflow-authoring-landed">
      <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>未发布草稿已创建</h2>
      <p data-testid="workflow-authoring-landed-note">{DRAFT_NOT_RUNTIME_NOTE}</p>
      <p style={mutedStyle} data-testid="workflow-authoring-workflow-id">
        草稿 {props.draft.workflowDraftId}
        {props.draft.workflowId ? ` · 工作流 ${props.draft.workflowId}` : ""}
        {props.draft.revision ? ` · revision ${props.draft.revision}` : ""}
      </p>
    </section>
  );
}

async function loadOrCreateSession(
  client: ReturnType<typeof useWorkforceClient>,
  projectId: string,
): Promise<AuthoringSessionViewDto> {
  const page = await client.listAuthoringSessions({ projectId, limit: 20 });
  const existing = page.items.find(
    (item) => item.projectId === projectId && item.status === "open",
  );
  if (existing) {
    return client.getAuthoringSession(existing.id);
  }
  return client.createAuthoringSession(projectId, writeCommandOptions());
}

function currentHash(): string {
  return typeof window === "undefined" ? "" : window.location.hash;
}

function isSettledTurn(status: AuthoringTurnDto["status"]): boolean {
  return (
    status === "awaiting_confirmation" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "closed"
  );
}

function busyLabel(action: Exclude<BusyAction, null>): string {
  switch (action) {
    case "loading":
      return "加载中…";
    case "sending":
      return "消息处理中…";
    case "confirming":
      return "确认处理中…";
    case "cancelling":
      return "取消处理中…";
    case "retrying":
      return "重试处理中…";
    case "closing":
      return "关闭处理中…";
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
