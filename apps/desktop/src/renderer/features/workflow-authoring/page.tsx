import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  AuthoringSessionViewDto,
  AuthoringTurnDto,
  ProjectDto,
} from "@workforce/desktop-client";

import {
  Badge,
  Button,
  Card,
  Cluster,
  EmptyState,
  ErrorText,
  Field,
  LoadingText,
  Muted,
  Notice,
  Page,
  Select,
  StatusText,
  Textarea,
} from "../../components/ui.js";
import type { FeaturePageProps } from "../contract.js";
import { useWorkforceClient } from "../hooks.js";
import {
  AGENT_REPLY_GAP,
  AUTHORING_PROPOSAL_PREVIEW_NOTE,
  AUTHORING_ROUTE_GAP,
  AUTHORING_RUN_NOT_COMPLETE_NOTE,
  DRAFT_CANVAS_NOTE,
  DRAFT_CANVAS_UNAVAILABLE_NOTE,
  DRAFT_NOT_RUNTIME_NOTE,
  EMPTY_INTENT_NOTE,
  activeAuthoringTurn,
  authoringTurnRefsNote,
  canCancelAuthoringTurn,
  canCloseAuthoringTurn,
  canRetryAuthoringTurn,
  errorMessage,
  isAuthoringSessionBoundToProject,
  isEmptyAuthoringIntent,
  isUnavailableMessage,
  landedDraftCanvasPath,
  projectLabel,
  proposalGraphNodeCount,
  proposalTeamSummary,
  proposalWorkflowName,
  resolveAuthoringProjectBinding,
  sessionStatusLabel,
  sessionStatusTone,
  turnStatusLabel,
  turnStatusTone,
  writeCommandOptions,
  type LandedAuthoringDraft,
  type ProposalAuthoringDraft,
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
  const [emptyIntent, setEmptyIntent] = useState(false);
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
    setSession((current) =>
      isAuthoringSessionBoundToProject(current, projectId) ? current : null,
    );
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
          setSession((current) =>
            isAuthoringSessionBoundToProject(current, projectId) ? current : null,
          );
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
    if (!current || current.status !== "open" || busy !== null) {
      return;
    }
    if (isEmptyAuthoringIntent(input)) {
      setEmptyIntent(true);
      return;
    }
    const content = input.trim();
    setBusy("sending");
    setError(null);
    setEmptyIntent(false);
    try {
      const accepted = await client.sendAuthoringMessage(
        current.id,
        content,
        writeCommandOptions(current.stateRevision),
      );
      await refreshUntilSettled(current.id, accepted.turnId);
      setInput("");
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
    setEmptyIntent(false);
  }

  const turn = activeAuthoringTurn(session);
  const sessionReady = session !== null && isAuthoringSessionBoundToProject(session, projectId);
  const awaitingConfirm =
    sessionReady && session.draft?.kind === "proposal" && turn?.status === "awaiting_confirmation";
  const landedDraft =
    sessionReady && session.draft?.kind === "landed" ? session.draft : null;
  const sendDisabled = !sessionReady || session.status !== "open" || busy !== null;
  const confirmDisabled = !awaitingConfirm || busy !== null;
  const sendVariant = awaitingConfirm || landedDraft ? "secondary" : "primary";

  return (
    <Page
      title="对话生成工作流"
      subtitle={AUTHORING_ROUTE_GAP}
      testId="workflow-authoring-page"
      actions={
        <Button variant="outline" onClick={() => props.navigate("/workflows")}>
          返回工作流目录
        </Button>
      }
    >
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
            sendVariant={sendVariant}
            onChange={(value) => {
              setInput(value);
              if (!isEmptyAuthoringIntent(value)) {
                setEmptyIntent(false);
              }
            }}
            onSend={onSend}
          />
          {awaitingConfirm && session.draft?.kind === "proposal" && turn ? (
            <ProposalDraftPreview
              draft={session.draft}
              turn={turn}
              onConfirm={onConfirm}
              disabled={confirmDisabled}
              confirming={busy === "confirming"}
            />
          ) : null}
          {landedDraft ? (
            <LandedDraftCard draft={landedDraft} navigate={props.navigate} />
          ) : null}
        </>
      ) : (
        <Card testId="workflow-authoring-session-loading">
          {projectId ? (
            busy === "loading" ? (
              <LoadingText>正在加载项目作者会话…</LoadingText>
            ) : (
              <EmptyState title="尚未建立项目作者会话。">
                加载失败时会保留已有对话；不会回退本地夹具冒充已接通。
              </EmptyState>
            )
          ) : (
            <EmptyState title="请选择项目后开始聊天。">会话始终绑定当前项目。</EmptyState>
          )}
        </Card>
      )}
      <Muted>
        <span data-testid="workflow-authoring-chat-note">{AGENT_REPLY_GAP}</span>
      </Muted>
      {emptyIntent ? (
        <Notice tone="warning" title="空意图未发送" role="status">
          <span data-testid="workflow-authoring-empty-intent">{EMPTY_INTENT_NOTE}</span>
        </Notice>
      ) : null}
      {error ? (
        <div data-testid="workflow-authoring-error">
          <ErrorText>{error}</ErrorText>
        </div>
      ) : null}
    </Page>
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
      <Card testId="workflow-authoring-project">
        <Badge tone="muted">项目范围</Badge>
        <Muted>当前项目：{props.routeProjectId}</Muted>
      </Card>
    );
  }
  return (
    <Card title="选择项目" testId="workflow-authoring-project-picker">
      {props.loading ? <LoadingText>正在加载项目…</LoadingText> : null}
      {!props.loading && props.projects.length === 0 ? (
        <Notice tone="warning">没有可用项目。请先创建项目，再打开工作流作者面。</Notice>
      ) : null}
      {!props.loading && props.projects.length > 0 ? (
        <Field label="项目" htmlFor="workflow-authoring-project">
          <Select
            id="workflow-authoring-project"
            testId="workflow-authoring-project-select"
            value={props.selectedProjectId}
            onChange={(event) => props.onChange(event.target.value)}
          >
            {props.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {projectLabel(project)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
    </Card>
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
  const refsNote = props.turn ? authoringTurnRefsNote(props.turn) : null;
  return (
    <Card title="会话状态" testId="workflow-authoring-session-status">
      <Cluster>
        <Badge tone={sessionStatusTone(props.session.status)}>
          会话 {sessionStatusLabel(props.session.status)}
        </Badge>
        {props.turn ? (
          <StatusText tone={turnStatusTone(props.turn.status)}>
            Turn {turnStatusLabel(props.turn.status)}
          </StatusText>
        ) : null}
        {props.busy ? <Muted>{busyLabel(props.busy)}</Muted> : null}
      </Cluster>
      <Muted>
        <span data-testid="workflow-authoring-session-id">
          会话 {props.session.id} · 项目 {props.session.projectId} · revision{" "}
          {props.session.stateRevision}
        </span>
      </Muted>
      <Notice tone="info" title="不是 Task/Run 完成">
        <span data-testid="workflow-authoring-run-note">{AUTHORING_RUN_NOT_COMPLETE_NOTE}</span>
      </Notice>
      {refsNote ? (
        <Muted>
          <span data-testid="workflow-authoring-turn-refs">{refsNote}</span>
        </Muted>
      ) : null}
      {props.turn ? (
        <div data-testid="workflow-authoring-turn-actions">
          <Cluster>
            {canCancelAuthoringTurn(props.turn.status) ? (
              <Button
                testId="workflow-authoring-cancel"
                variant="dangerOutline"
                disabled={props.busy !== null}
                onClick={props.onCancel}
              >
                {props.busy === "cancelling" ? "取消中…" : "取消生成"}
              </Button>
            ) : null}
            {canRetryAuthoringTurn(props.turn.status) ? (
              <Button
                testId="workflow-authoring-retry"
                variant="secondary"
                disabled={props.busy !== null}
                onClick={props.onRetry}
              >
                {props.busy === "retrying" ? "重试中…" : "重试生成"}
              </Button>
            ) : null}
            {canCloseAuthoringTurn(props.turn.status) ? (
              <Button
                testId="workflow-authoring-close"
                variant="outline"
                disabled={props.busy !== null}
                onClick={props.onClose}
              >
                {props.busy === "closing" ? "关闭中…" : "关闭当前会话"}
              </Button>
            ) : null}
          </Cluster>
        </div>
      ) : null}
    </Card>
  );
}

function ConversationPanel(props: {
  session: AuthoringSessionViewDto;
  input: string;
  disabled: boolean;
  busy: BusyAction;
  sendVariant: "primary" | "secondary";
  onChange: (value: string) => void;
  onSend: () => void;
}): ReactNode {
  return (
    <Card title="工作流编排对话" testId="workflow-authoring-chat">
      <MessageList messages={props.session.messages} />
      <Field
        label="发送消息"
        htmlFor="wf-authoring-intent"
        hint={EMPTY_INTENT_NOTE}
      >
        <Textarea
          id="wf-authoring-intent"
          testId="workflow-authoring-intent"
          rows={4}
          value={props.input}
          disabled={props.busy !== null}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder="例如：创建一个包含规划、实现和审查的工作流。"
        />
      </Field>
      <Button
        testId="workflow-authoring-send-chat"
        variant={props.sendVariant}
        disabled={props.disabled}
        onClick={props.onSend}
      >
        {props.busy === "sending" ? "发送中…" : "发送消息"}
      </Button>
    </Card>
  );
}

function MessageList(props: {
  messages: readonly AuthoringSessionViewDto["messages"][number][];
}): ReactNode {
  if (props.messages.length === 0) {
    return (
      <EmptyState testId="workflow-authoring-chat-empty" title="还没有消息。">
        描述角色、流程和任务后发送。空意图不会清空对话。
      </EmptyState>
    );
  }
  return (
    <div data-testid="workflow-authoring-messages">
      {props.messages.map((message) => (
        <Card
          key={message.id}
          variant="subtle"
          testId={`workflow-authoring-message-${message.role}`}
        >
          <strong>
            {message.role === "user" ? "用户" : message.role === "system" ? "系统" : "编排 Agent"}
          </strong>
          {isUnavailableMessage(message.content) ? (
            <Notice tone="warning">消息正文在 Daemon 重启后不可恢复，仅保留引用。</Notice>
          ) : (
            <p>{message.content}</p>
          )}
        </Card>
      ))}
    </div>
  );
}

function ProposalDraftPreview(props: {
  draft: ProposalAuthoringDraft;
  turn: AuthoringTurnDto;
  onConfirm: () => void;
  disabled: boolean;
  confirming: boolean;
}): ReactNode {
  const teamSummary = proposalTeamSummary(props.draft);
  return (
    <Card title="结构化提案待确认" testId="workflow-authoring-proposal-preview">
      <Muted>
        <span data-testid="workflow-authoring-proposal-preview-note">
          {AUTHORING_PROPOSAL_PREVIEW_NOTE}
        </span>
      </Muted>
      <p data-testid="workflow-authoring-proposal-name">
        工作流：{proposalWorkflowName(props.draft)}
      </p>
      {props.draft.workflow?.description ? <Muted>{props.draft.workflow.description}</Muted> : null}
      <Muted>
        <span data-testid="workflow-authoring-proposal-graph">
          结构化节点：{proposalGraphNodeCount(props.draft)}
        </span>
      </Muted>
      {teamSummary ? <Muted>{teamSummary}</Muted> : null}
      <Button
        testId="workflow-authoring-confirm"
        variant="primary"
        disabled={props.disabled}
        onClick={props.onConfirm}
      >
        {props.confirming ? "确认中…" : "确认并创建未发布草稿"}
      </Button>
      <Muted>
        Turn {props.turn.id} · revision {props.turn.revision}
      </Muted>
    </Card>
  );
}

function LandedDraftCard(props: {
  draft: LandedAuthoringDraft;
  navigate: (path: string) => void;
}): ReactNode {
  const canvasPath = landedDraftCanvasPath(props.draft);
  return (
    <Card title="未发布草稿已创建" testId="workflow-authoring-landed">
      <p data-testid="workflow-authoring-landed-note">{DRAFT_NOT_RUNTIME_NOTE}</p>
      <Muted>
        <span data-testid="workflow-authoring-workflow-id">
          草稿 {props.draft.workflowDraftId}
          {props.draft.workflowId ? ` · 工作流 ${props.draft.workflowId}` : ""}
          {props.draft.revision ? ` · revision ${props.draft.revision}` : ""}
        </span>
      </Muted>
      {canvasPath ? (
        <>
          <Muted>
            <span data-testid="workflow-authoring-canvas-note">{DRAFT_CANVAS_NOTE}</span>
          </Muted>
          <Button
            testId="workflow-authoring-open-canvas"
            variant="primary"
            onClick={() => props.navigate(canvasPath)}
          >
            打开画布编辑
          </Button>
        </>
      ) : (
        <Notice tone="warning">
          <span data-testid="workflow-authoring-canvas-unavailable">
            {DRAFT_CANVAS_UNAVAILABLE_NOTE}
          </span>
        </Notice>
      )}
    </Card>
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
