import { useEffect, useState, type ReactNode } from "react";
import type {
  CapabilitiesDto,
  ChatClassifyInput,
  ChatClassifyResultDto,
  DesktopClient,
  ProjectDto,
  ProjectProgressProjectionDto,
  RunDto,
  WorkerDto,
} from "@workforce/desktop-client";
import type { ChatIntentDto } from "@workforce/protocol";

import { useOptionalWorkforceContext } from "../../app/workforce-context.js";
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
  Textarea,
} from "../../components/ui.js";
import type { FeaturePageProps } from "../contract.js";
import { useWorkforceClient, useWorkforceConnection } from "../hooks.js";
import {
  confirmWorkflowAuthoringTurn,
  isWorkflowProposalReady,
  landedWorkflowDraft,
  lastAuthoringTurn,
  sendWorkflowAuthoringMessage,
} from "./authoring.js";
import {
  CHAT_NOT_AUTHORING_ONLY,
  CHAT_NOT_IM,
  CHAT_SUBTITLE,
  CREATE_WORKER_LANDED_NOTE,
  CREATE_WORKER_PROPOSAL_NOTE,
  CREATE_WORKFLOW_LANDED_NOTE,
  CREATE_WORKFLOW_NEEDS_PROJECT,
  CREATE_WORKFLOW_PROPOSAL_NOTE,
  DIRECT_UNSUPPORTED_NOTE,
  DISCUSS_NEEDS_RUN,
  DISCUSS_SENT_NOTE,
  PROGRESS_FACT_NOTE,
  TURN_CONFIRMED_IS_NOT_DONE,
  classifyUnsupportedAction,
  errorCode,
  errorMessage,
  hasCompletionFact,
  intentKindLabel,
  isActiveRun,
  isDirectCapabilityReady,
  isEmptyChatIntent,
  landedDraftCanvasPath,
  newChatId,
  progressEmptyMessage,
  roleLibraryPath,
  workerWriteFromText,
  writeCommandOptions,
  type WorkerProposalWrite,
} from "./model.js";

type BusyAction = "classify" | "confirming" | null;

interface UserEntry {
  id: string;
  kind: "user";
  text: string;
}

interface NeedContextEntry {
  id: string;
  kind: "need_context";
  missing: "projectId" | "runId";
  text: string;
}

interface UnsupportedEntry {
  id: string;
  kind: "unsupported";
  action: "direct" | "im";
  code: "unsupported_capability";
}

interface CreateWorkerEntry {
  id: string;
  kind: "create_worker";
  summary: string;
  write: WorkerProposalWrite;
  phase: "proposal" | "landed";
  worker?: WorkerDto;
}

interface CreateWorkflowEntry {
  id: string;
  kind: "create_workflow";
  projectId: string;
  summary: string;
  phase: "proposal" | "landed" | "failed";
  sessionId?: string;
  turnId?: string;
  workflowDraftId?: string;
  workflowId?: string;
  unpublished?: true;
  error?: string;
}

interface ProgressEntry {
  id: string;
  kind: "progress";
  projection: ProjectProgressProjectionDto;
}

interface DiscussEntry {
  id: string;
  kind: "discuss_work";
  projectId: string;
  runId?: string;
  phase: "need_run" | "sent" | "blocked";
  runStatus?: string;
  detail: string;
}

interface ErrorEntry {
  id: string;
  kind: "error";
  detail: string;
  code?: string;
}

type ChatEntry =
  | UserEntry
  | NeedContextEntry
  | UnsupportedEntry
  | CreateWorkerEntry
  | CreateWorkflowEntry
  | ProgressEntry
  | DiscussEntry
  | ErrorEntry;

export function ChatPage(props: FeaturePageProps): ReactNode {
  const client = useWorkforceClient();
  const connection = useWorkforceConnection();
  const capabilities = useOptionalWorkforceContext()?.capabilities ?? null;
  const online = connection.status === "online";
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [runs, setRuns] = useState<RunDto[]>([]);
  const [projectId, setProjectId] = useState("");
  const [runId, setRunId] = useState("");
  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [emptyIntent, setEmptyIntent] = useState(false);

  useEffect(() => {
    if (!online) {
      return;
    }
    let cancelled = false;
    void client
      .listProjects({ limit: 100 })
      .then((page) => {
        if (!cancelled) {
          setProjects(page.items);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(errorMessage(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, online]);

  useEffect(() => {
    if (!online || !projectId) {
      setRuns([]);
      setRunId("");
      return;
    }
    let cancelled = false;
    void client
      .listRuns({ projectId, limit: 50 })
      .then((page) => {
        if (cancelled) {
          return;
        }
        setRuns(page.items);
        setRunId((current) => (page.items.some((item) => item.id === current) ? current : ""));
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(errorMessage(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, online, projectId]);

  async function onSend(): Promise<void> {
    if (busy !== null || !online) {
      return;
    }
    if (isEmptyChatIntent(input)) {
      setEmptyIntent(true);
      return;
    }
    const text = input.trim();
    setEmptyIntent(false);
    setError(null);
    setBusy("classify");
    setEntries((current) => [...current, { id: newChatId("usr"), kind: "user", text }]);
    setInput("");
    try {
      const result = await classify(client, text, projectId, runId);
      const next = await dispatchIntent(client, result, text, capabilities);
      setEntries((current) => [...current, ...next]);
      setBusy(null);
    } catch (reason: unknown) {
      setBusy(null);
      const detail = errorMessage(reason);
      const code = errorCode(reason);
      setError(detail);
      const entry: ErrorEntry = { id: newChatId("err"), kind: "error", detail };
      if (code) {
        entry.code = code;
      }
      setEntries((current) => [...current, entry]);
    }
  }

  async function onConfirmWorker(entryId: string): Promise<void> {
    const entry = entries.find(
      (item): item is CreateWorkerEntry => item.id === entryId && item.kind === "create_worker",
    );
    if (!entry || entry.phase !== "proposal" || busy !== null) {
      return;
    }
    setBusy("confirming");
    setError(null);
    try {
      const worker = await client.createWorker(
        {
          name: entry.write.name,
          role: entry.write.role,
          ...(entry.write.description.trim() ? { description: entry.write.description } : {}),
        },
        writeCommandOptions(),
      );
      if (worker.status !== "draft") {
        throw new Error("确认结果不是未发布草稿，已拒绝当成已发布员工。");
      }
      setEntries((current) =>
        current.map((item) =>
          item.id === entryId && item.kind === "create_worker"
            ? { ...item, phase: "landed", worker }
            : item,
        ),
      );
      setBusy(null);
    } catch (reason: unknown) {
      setBusy(null);
      setError(errorMessage(reason));
    }
  }

  async function onConfirmWorkflow(entryId: string): Promise<void> {
    const entry = entries.find(
      (item): item is CreateWorkflowEntry => item.id === entryId && item.kind === "create_workflow",
    );
    if (!entry || entry.phase !== "proposal" || !entry.sessionId || busy !== null) {
      return;
    }
    setBusy("confirming");
    setError(null);
    try {
      const session = await client.getAuthoringSession(entry.sessionId);
      const confirmed = await confirmWorkflowAuthoringTurn(client, session);
      const landed = landedWorkflowDraft(confirmed);
      const turn = lastAuthoringTurn(confirmed);
      setEntries((current) =>
        current.map((item) => {
          if (item.id !== entryId || item.kind !== "create_workflow") {
            return item;
          }
          if (!landed) {
            return {
              ...item,
              phase: "failed",
              error: "确认后没有未发布 WorkflowDraft。未把对话当成已执行。",
            };
          }
          const next: CreateWorkflowEntry = {
            ...item,
            phase: "landed",
            unpublished: true,
            sessionId: confirmed.id,
          };
          if (turn) {
            next.turnId = turn.id;
          }
          if (landed.workflowDraftId) {
            next.workflowDraftId = landed.workflowDraftId;
          }
          if (landed.workflowId) {
            next.workflowId = landed.workflowId;
          }
          return next;
        }),
      );
      setBusy(null);
    } catch (reason: unknown) {
      setBusy(null);
      setError(errorMessage(reason));
    }
  }

  const sendDisabled = busy !== null || !online;
  const directReady = isDirectCapabilityReady(capabilities?.orchestration?.direct);

  return (
    <Page
      title="Chat"
      subtitle={CHAT_SUBTITLE}
      testId="chat-page"
      actions={
        <Button
          variant="outline"
          testId="chat-open-role-library"
          onClick={() => props.navigate(roleLibraryPath())}
        >
          打开角色库
        </Button>
      }
    >
      <Notice tone="info" title="不是作者页，也不是 IM">
        <Muted>{CHAT_NOT_AUTHORING_ONLY}</Muted>
        <Muted>{CHAT_NOT_IM}</Muted>
      </Notice>
      <BindingBar
        projects={projects}
        runs={runs}
        projectId={projectId}
        runId={runId}
        online={online}
        onProjectChange={setProjectId}
        onRunChange={setRunId}
      />
      <Card testId="chat-direct-closed">
        <Cluster>
          <Button testId="chat-direct-go" variant="outline" disabled>
            去做
          </Button>
          <Badge tone="warning">unsupported_capability</Badge>
        </Cluster>
        <Muted>{DIRECT_UNSUPPORTED_NOTE}</Muted>
        {directReady ? (
          <Muted>能力矩阵即使标记 direct，本批 Chat 也不调度，避免假成功。</Muted>
        ) : null}
      </Card>
      <Transcript
        entries={entries}
        busy={busy}
        navigate={props.navigate}
        onConfirmWorker={(id) => {
          void onConfirmWorker(id);
        }}
        onConfirmWorkflow={(id) => {
          void onConfirmWorkflow(id);
        }}
      />
      <Card title="发送" testId="chat-composer">
        <Field label="用语言描述要做的事" htmlFor="chat-intent" hint="空意图不会发送。">
          <Textarea
            id="chat-intent"
            testId="chat-intent"
            rows={4}
            value={input}
            disabled={busy !== null}
            placeholder="例如：创建角色 reviewer；创建流程；问进度；交流工作内容。不要写「去做」。"
            onChange={(event) => {
              setInput(event.target.value);
              if (!isEmptyChatIntent(event.target.value)) {
                setEmptyIntent(false);
              }
            }}
          />
        </Field>
        <Button
          testId="chat-send"
          variant="primary"
          disabled={sendDisabled}
          onClick={() => void onSend()}
        >
          {busy === "classify" ? "分类中…" : "发送"}
        </Button>
        {emptyIntent ? (
          <Notice tone="warning" title="空意图未发送">
            当前对话和未确认提案都保留，不会回退夹具或伪造成成功。
          </Notice>
        ) : null}
        {!online ? (
          <Notice tone="warning">Daemon 未在线。不会把未接通画成已创建或已完成。</Notice>
        ) : null}
        {error ? (
          <div data-testid="chat-error">
            <ErrorText>{error}</ErrorText>
          </div>
        ) : null}
      </Card>
    </Page>
  );
}

function BindingBar(props: {
  projects: readonly ProjectDto[];
  runs: readonly RunDto[];
  projectId: string;
  runId: string;
  online: boolean;
  onProjectChange: (projectId: string) => void;
  onRunChange: (runId: string) => void;
}): ReactNode {
  const activeRuns = props.runs.filter((run) => isActiveRun(run.status));
  return (
    <Card title="挂点" testId="chat-binding">
      <Cluster>
        <Field label="项目" htmlFor="chat-project">
          <Select
            id="chat-project"
            testId="chat-project-select"
            value={props.projectId}
            disabled={!props.online}
            onChange={(event) => props.onProjectChange(event.target.value)}
          >
            <option value="">未选择（创建角色可不选；创建流程 / 问进度 / 交流工作要选）</option>
            {props.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} · {project.id}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Run" htmlFor="chat-run">
          <Select
            id="chat-run"
            testId="chat-run-select"
            value={props.runId}
            disabled={!props.online || !props.projectId}
            onChange={(event) => props.onRunChange(event.target.value)}
          >
            <option value="">未选择（交流执行中的工作才需要）</option>
            {activeRuns.map((run) => (
              <option key={run.id} value={run.id}>
                {run.id} · {run.status}
              </option>
            ))}
          </Select>
        </Field>
      </Cluster>
      <Muted>{CREATE_WORKFLOW_NEEDS_PROJECT} 没有 projectId / runId 时只问，不发写。</Muted>
    </Card>
  );
}

function Transcript(props: {
  entries: readonly ChatEntry[];
  busy: BusyAction;
  navigate: (path: string) => void;
  onConfirmWorker: (id: string) => void;
  onConfirmWorkflow: (id: string) => void;
}): ReactNode {
  if (props.entries.length === 0) {
    return (
      <Card testId="chat-empty">
        <EmptyState title="还没有对话。">
          随时可说：创建角色、创建流程、问进度、交流工作。分类结果不是完成态。
        </EmptyState>
      </Card>
    );
  }
  return (
    <div data-testid="chat-transcript">
      {props.entries.map((entry) => (
        <EntryCard
          key={entry.id}
          entry={entry}
          busy={props.busy}
          navigate={props.navigate}
          onConfirmWorker={props.onConfirmWorker}
          onConfirmWorkflow={props.onConfirmWorkflow}
        />
      ))}
      {props.busy === "classify" ? <LoadingText>正在分类并处理意图…</LoadingText> : null}
    </div>
  );
}

function EntryCard(props: {
  entry: ChatEntry;
  busy: BusyAction;
  navigate: (path: string) => void;
  onConfirmWorker: (id: string) => void;
  onConfirmWorkflow: (id: string) => void;
}): ReactNode {
  const { entry } = props;
  switch (entry.kind) {
    case "user":
      return (
        <Card variant="subtle" testId={`chat-entry-user-${entry.id}`}>
          <Badge>你</Badge>
          <p>{entry.text}</p>
        </Card>
      );
    case "need_context":
      return (
        <Card testId={`chat-need-${entry.missing}`}>
          <Badge tone="warning">还缺挂点</Badge>
          <p>
            {entry.missing === "projectId"
              ? "还缺项目。创建流程、问进度、交流工作都要有 projectId。没有写入对象。"
              : DISCUSS_NEEDS_RUN}
          </p>
          <Muted>分类保留了原话，选好挂点后再发送。</Muted>
        </Card>
      );
    case "unsupported":
      return (
        <Card testId={`chat-unsupported-${entry.action}`}>
          <Badge tone="danger">{entry.code}</Badge>
          <p>
            {entry.action === "direct"
              ? "direct / 「去做」未接通。没有创建 Task/Run，也没有渲染成已在跑。"
              : "没有 IM / 收件箱 / 私聊。这句话没有写入任何对象。"}
          </p>
        </Card>
      );
    case "create_worker":
      return (
        <WorkerIntentCard
          entry={entry}
          confirming={props.busy === "confirming"}
          onConfirm={() => props.onConfirmWorker(entry.id)}
          onOpenLibrary={() => props.navigate(roleLibraryPath())}
        />
      );
    case "create_workflow":
      return (
        <WorkflowIntentCard
          entry={entry}
          confirming={props.busy === "confirming"}
          onConfirm={() => props.onConfirmWorkflow(entry.id)}
          onOpenCanvas={(path) => props.navigate(path)}
        />
      );
    case "progress":
      return <ProgressCard projection={entry.projection} />;
    case "discuss_work":
      return (
        <Card testId={`chat-discuss-${entry.phase}`}>
          <Badge tone={entry.phase === "sent" ? "info" : "warning"}>
            {intentKindLabel("discuss_work")}
          </Badge>
          <p>{entry.detail}</p>
          <Muted>
            项目 {entry.projectId}
            {entry.runId ? ` · Run ${entry.runId}` : ""}
            {entry.runStatus ? ` · ${entry.runStatus}` : ""}
          </Muted>
        </Card>
      );
    case "error":
      return (
        <Card testId="chat-entry-error">
          <Badge tone="danger">{entry.code ?? "error"}</Badge>
          <ErrorText>{entry.detail}</ErrorText>
        </Card>
      );
  }
}

function WorkerIntentCard(props: {
  entry: CreateWorkerEntry;
  confirming: boolean;
  onConfirm: () => void;
  onOpenLibrary: () => void;
}): ReactNode {
  const { entry } = props;
  if (entry.phase === "landed" && entry.worker) {
    return (
      <Card testId="chat-worker-landed">
        <Badge tone="muted">未发布草稿</Badge>
        <p>{CREATE_WORKER_LANDED_NOTE}</p>
        <Muted>
          {entry.worker.name} · {entry.worker.id} · status {entry.worker.status}
        </Muted>
        <Button
          testId="chat-open-role-library-after"
          variant="primary"
          onClick={props.onOpenLibrary}
        >
          打开角色库
        </Button>
      </Card>
    );
  }
  return (
    <Card title="创建角色提案" testId="chat-worker-proposal">
      <Muted>{CREATE_WORKER_PROPOSAL_NOTE}</Muted>
      <p>
        {entry.write.name} · 职责 {entry.write.role}
      </p>
      <Muted>{entry.summary}</Muted>
      <Button
        testId="chat-confirm-worker"
        variant="primary"
        disabled={props.confirming}
        onClick={props.onConfirm}
      >
        {props.confirming ? "确认中…" : "确认并写入未发布草稿"}
      </Button>
    </Card>
  );
}

function WorkflowIntentCard(props: {
  entry: CreateWorkflowEntry;
  confirming: boolean;
  onConfirm: () => void;
  onOpenCanvas: (path: string) => void;
}): ReactNode {
  const { entry } = props;
  if (entry.phase === "failed") {
    return (
      <Card testId="chat-workflow-failed">
        <Badge tone="danger">未落地</Badge>
        <ErrorText>{entry.error}</ErrorText>
        <Muted>{TURN_CONFIRMED_IS_NOT_DONE}</Muted>
      </Card>
    );
  }
  if (entry.phase === "landed") {
    const canvasPath = landedDraftCanvasPath({
      unpublished: true,
      ...(entry.workflowDraftId ? { workflowDraftId: entry.workflowDraftId } : {}),
      ...(entry.workflowId ? { workflowId: entry.workflowId } : {}),
    });
    return (
      <Card testId="chat-workflow-landed">
        <Badge tone="muted">未发布 WorkflowDraft</Badge>
        <p>{CREATE_WORKFLOW_LANDED_NOTE}</p>
        <Muted>
          草稿 {entry.workflowDraftId ?? "（未返回 draft id）"}
          {entry.workflowId ? ` · 工作流 ${entry.workflowId}` : ""}
        </Muted>
        <Muted>{TURN_CONFIRMED_IS_NOT_DONE}</Muted>
        {canvasPath ? (
          <Button
            testId="chat-open-canvas"
            variant="primary"
            onClick={() => props.onOpenCanvas(canvasPath)}
          >
            打开画布编辑
          </Button>
        ) : (
          <Notice tone="warning">
            草稿已落地，但会话未返回 workflowId，无法跳到画布。未发布草稿仍不会被执行。
          </Notice>
        )}
      </Card>
    );
  }
  return (
    <Card title="创建流程提案" testId="chat-workflow-proposal">
      <Muted>{CREATE_WORKFLOW_PROPOSAL_NOTE}</Muted>
      <p>{entry.summary}</p>
      <Muted>
        项目 {entry.projectId}
        {entry.sessionId ? ` · 会话 ${entry.sessionId}` : ""}
      </Muted>
      <Button
        testId="chat-confirm-workflow"
        variant="primary"
        disabled={props.confirming}
        onClick={props.onConfirm}
      >
        {props.confirming ? "确认中…" : "确认并创建未发布草稿"}
      </Button>
    </Card>
  );
}

function ProgressCard(props: { projection: ProjectProgressProjectionDto }): ReactNode {
  const empty = progressEmptyMessage(props.projection);
  if (empty) {
    return (
      <Card testId="chat-progress-empty">
        <Badge tone="muted">{intentKindLabel("query_progress")}</Badge>
        <p data-testid="chat-progress-empty-display">{empty}</p>
        <Muted>{PROGRESS_FACT_NOTE}</Muted>
      </Card>
    );
  }
  return (
    <Card title="进度投影" testId="chat-progress">
      <Muted>{PROGRESS_FACT_NOTE}</Muted>
      <FactList
        label="Task"
        items={props.projection.tasks.map((task) => `${task.title} · ${task.status} · ${task.id}`)}
      />
      <FactList
        label="Run"
        items={props.projection.runs.map((run) => `${run.id} · ${run.status} · task ${run.taskId}`)}
      />
      <FactList
        label="Event"
        items={props.projection.events.map(
          (event) => `${event.type} · ${event.time} · ${event.id}`,
        )}
      />
      <FactList
        label="Artifact"
        items={props.projection.artifacts.map(
          (artifact) =>
            `${artifact.id} · ${artifact.versionId}${artifact.status ? ` · ${artifact.status}` : ""}`,
        )}
      />
      {!hasCompletionFact(props.projection) ? (
        <Notice tone="info">没有 Artifact。不会把上面的状态画成「做完了」。</Notice>
      ) : null}
    </Card>
  );
}

function FactList(props: { label: string; items: readonly string[] }): ReactNode {
  if (props.items.length === 0) {
    return <Muted>{props.label}：无</Muted>;
  }
  return (
    <div>
      <strong>{props.label}</strong>
      {props.items.map((item) => (
        <Muted key={item}>{item}</Muted>
      ))}
    </div>
  );
}

async function classify(
  client: DesktopClient,
  text: string,
  projectId: string,
  runId: string,
): Promise<ChatClassifyResultDto> {
  const body: ChatClassifyInput = { text };
  if (projectId) {
    body.projectId = projectId;
  }
  if (runId) {
    body.runId = runId;
  }
  return client.classifyChatIntent(body, writeCommandOptions());
}

async function dispatchIntent(
  client: DesktopClient,
  result: ChatClassifyResultDto,
  text: string,
  capabilities: CapabilitiesDto | null,
): Promise<ChatEntry[]> {
  const unsupported = classifyUnsupportedAction(result);
  if (result.outcome === "unsupported" && unsupported) {
    return [
      {
        id: newChatId("uns"),
        kind: "unsupported",
        action: unsupported,
        code: "unsupported_capability",
      },
    ];
  }
  if (result.outcome === "need_context") {
    return [
      {
        id: newChatId("need"),
        kind: "need_context",
        missing: result.missing,
        text,
      },
    ];
  }
  if (result.outcome !== "intent") {
    return [{ id: newChatId("err"), kind: "error", detail: "分类结果无法识别，没有写入对象。" }];
  }
  return handleIntent(client, result.intent, text, capabilities);
}

async function handleIntent(
  client: DesktopClient,
  intent: ChatIntentDto,
  text: string,
  capabilities: CapabilitiesDto | null,
): Promise<ChatEntry[]> {
  switch (intent.kind) {
    case "create_worker":
      return [
        {
          id: newChatId("wrk"),
          kind: "create_worker",
          summary: intent.summary ?? text,
          write: workerWriteFromText(intent.summary ?? text),
          phase: "proposal",
        },
      ];
    case "create_workflow":
      return startWorkflowAuthoring(client, intent.projectId, intent.summary ?? text);
    case "query_progress": {
      const projection = await client.getProjectProgress(intent.projectId);
      return [{ id: newChatId("prg"), kind: "progress", projection }];
    }
    case "discuss_work":
      return sendDiscussWork(client, intent, text, capabilities);
  }
}

async function startWorkflowAuthoring(
  client: DesktopClient,
  projectId: string,
  summary: string,
): Promise<ChatEntry[]> {
  try {
    const session = await sendWorkflowAuthoringMessage(client, projectId, summary);
    const turn = lastAuthoringTurn(session);
    if (!isWorkflowProposalReady(session) || !turn) {
      return [
        {
          id: newChatId("wf"),
          kind: "create_workflow",
          projectId,
          summary,
          phase: "failed",
          sessionId: session.id,
          error: "AuthoringSession 没有进入待确认提案。未发布、未执行。",
        },
      ];
    }
    return [
      {
        id: newChatId("wf"),
        kind: "create_workflow",
        projectId,
        summary,
        phase: "proposal",
        sessionId: session.id,
        turnId: turn.id,
      },
    ];
  } catch (reason: unknown) {
    return [
      {
        id: newChatId("wf"),
        kind: "create_workflow",
        projectId,
        summary,
        phase: "failed",
        error: errorMessage(reason),
      },
    ];
  }
}

async function sendDiscussWork(
  client: DesktopClient,
  intent: Extract<ChatIntentDto, { kind: "discuss_work" }>,
  text: string,
  capabilities: CapabilitiesDto | null,
): Promise<ChatEntry[]> {
  if (!intent.runId) {
    return [
      {
        id: newChatId("dsc"),
        kind: "discuss_work",
        projectId: intent.projectId,
        phase: "need_run",
        detail: DISCUSS_NEEDS_RUN,
      },
    ];
  }
  if (capabilities !== null && capabilities.run.input !== true) {
    return [
      {
        id: newChatId("dsc"),
        kind: "discuss_work",
        projectId: intent.projectId,
        runId: intent.runId,
        phase: "blocked",
        detail: "Run input 能力未接通。没有发写，也没有当成已在跑。",
      },
    ];
  }
  const run = await client.sendRunInput(intent.runId, { text }, writeCommandOptions());
  return [
    {
      id: newChatId("dsc"),
      kind: "discuss_work",
      projectId: intent.projectId,
      runId: intent.runId,
      phase: "sent",
      runStatus: run.status,
      detail: DISCUSS_SENT_NOTE,
    },
  ];
}
