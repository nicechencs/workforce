import { useEffect, useState, type ReactNode } from "react";
import type {
  AuthoringChatProposalDto,
  CapabilitiesDto,
  ChatClassifyInput,
  ChatClassifyResultDto,
  DesktopClient,
  ProjectDto,
  ProjectProgressProjectionDto,
  RunDto,
  TaskDto,
  WorkerDto,
} from "@workforce/desktop-client";
import type {
  ChatIntentDto,
  ChatNeedContextMissing,
  WorkerCardFieldName,
} from "@workforce/protocol";

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
  isAuthoringProposalReady,
  landedWorkflowDraft,
  lastAuthoringTurn,
  loadChatProposalForTurn,
  proposalHasTaskTarget,
  sendWorkflowAuthoringMessage,
  taskTargetsFromProposal,
} from "./authoring.js";
import {
  CARD_FIELD_LABELS,
  CHAT_NOT_AUTHORING_ONLY,
  CHAT_NOT_IM,
  CHAT_SUBTITLE,
  CREATE_WORKER_LANDED_NOTE,
  CREATE_WORKER_PROPOSAL_NOTE,
  CREATE_WORKFLOW_LANDED_NOTE,
  CREATE_WORKFLOW_NEEDS_PROJECT,
  CREATE_WORKFLOW_PROPOSAL_NOTE,
  DIRECT_READY_NOTE,
  DIRECT_UNSUPPORTED_NOTE,
  DISCUSS_NEEDS_RUN,
  DISCUSS_SENT_NOTE,
  INVITE_ALREADY_ON_TEAM,
  INVITE_TEAM_LANDED_NOTE,
  INVITE_TEAM_UNPUBLISHED_NOTE,
  NEED_CLARIFICATION_NOTE,
  PROGRESS_FACT_NOTE,
  START_DIRECT_LANDED_NOTE,
  START_DIRECT_NEEDS_PROJECT,
  TASK_PATCH_LANDED_NOTE,
  TASK_PATCH_PROPOSAL_NOTE,
  TURN_CONFIRMED_IS_NOT_DONE,
  UPDATE_WORKER_FORKED_NOTE,
  UPDATE_WORKER_LANDED_NOTE,
  classifiedIntents,
  classifyUnsupportedAction,
  createWorkerInputFromWrite,
  createWorkerWriteFromIntent,
  errorCode,
  errorMessage,
  hasCompletionFact,
  intentKindLabel,
  isActiveRun,
  isDirectCapabilityReady,
  isEmptyChatIntent,
  landIdleWorkerRemark,
  landInviteTeam,
  landStartDirect,
  landedDraftCanvasPath,
  needContextMessage,
  newChatId,
  progressEmptyMessage,
  roleLibraryPath,
  selectablePublishedVersion,
  startDirectIntentFromHanging,
  writeCommandOptions,
  type WorkerProposalWrite,
} from "./model.js";

type BusyAction = "classify" | "confirming" | "starting" | null;

interface UserEntry {
  id: string;
  kind: "user";
  text: string;
}

interface NeedContextEntry {
  id: string;
  kind: "need_context";
  missing: ChatNeedContextMissing;
  text: string;
}

interface ClarificationEntry {
  id: string;
  kind: "need_clarification";
  question: string;
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

interface UpdateWorkerEntry {
  id: string;
  kind: "update_worker";
  cardField: WorkerCardFieldName;
  workerId: string;
  draftId: string;
  phase: "landed" | "failed";
  forkedFromWorkerVersionId?: string;
  error?: string;
}

interface InviteTeamEntry {
  id: string;
  kind: "invite_team";
  projectId: string;
  workerVersionId: string;
  phase: "landed" | "failed";
  teamId?: string;
  teamVersionId?: string;
  alreadyMember?: boolean;
  error?: string;
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
  proposal?: AuthoringChatProposalDto;
  taskId?: string;
  definitionRevision?: number;
  error?: string;
}

interface StartDirectEntry {
  id: string;
  kind: "start_direct";
  projectId: string;
  phase: "started" | "failed";
  taskId?: string;
  runId?: string;
  runStatus?: string;
  createdAdHocTask?: boolean;
  detail: string;
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
  | ClarificationEntry
  | UnsupportedEntry
  | CreateWorkerEntry
  | UpdateWorkerEntry
  | InviteTeamEntry
  | CreateWorkflowEntry
  | StartDirectEntry
  | ProgressEntry
  | DiscussEntry
  | ErrorEntry;

export function ChatPage(props: FeaturePageProps): ReactNode {
  const client = useWorkforceClient();
  const connection = useWorkforceConnection();
  const capabilities = useOptionalWorkforceContext()?.capabilities ?? null;
  const online = connection.status === "online";
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [workers, setWorkers] = useState<WorkerDto[]>([]);
  const [runs, setRuns] = useState<RunDto[]>([]);
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [projectId, setProjectId] = useState("");
  const [runId, setRunId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [workerVersionId, setWorkerVersionId] = useState("");
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
    void Promise.all([client.listProjects({ limit: 100 }), client.listWorkers({ limit: 100 })])
      .then(([projectPage, workerPage]) => {
        if (cancelled) {
          return;
        }
        setProjects(projectPage.items);
        setWorkers(workerPage.items);
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
      setTasks([]);
      setTaskId("");
      return;
    }
    let cancelled = false;
    void Promise.all([
      client.listRuns({ projectId, limit: 50 }),
      client.listTasks({ projectId, limit: 50 }),
    ])
      .then(([runPage, taskPage]) => {
        if (cancelled) {
          return;
        }
        setRuns(runPage.items);
        setTasks(taskPage.items);
        setRunId((current) => (runPage.items.some((item) => item.id === current) ? current : ""));
        setTaskId((current) => (taskPage.items.some((item) => item.id === current) ? current : ""));
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

  function onWorkerChange(nextWorkerId: string): void {
    setWorkerId(nextWorkerId);
    const worker = workers.find((item) => item.id === nextWorkerId);
    const published = worker === undefined ? undefined : selectablePublishedVersion(worker);
    setWorkerVersionId(published?.id ?? "");
  }

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
      const result = await classify(client, {
        text,
        projectId,
        runId,
        taskId,
        workerId,
        workerVersionId,
      });
      const next = await dispatchResult(client, result, text, capabilities, {
        projectId,
        taskId,
      });
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

  async function onGoDirect(): Promise<void> {
    if (busy !== null || !online || !isDirectCapabilityReady(capabilities?.orchestration?.direct)) {
      return;
    }
    setEmptyIntent(false);
    setError(null);
    if (!projectId) {
      setEntries((current) => [
        ...current,
        {
          id: newChatId("need"),
          kind: "need_context",
          missing: "projectId",
          text: input.trim() || "去做",
        },
      ]);
      return;
    }
    const hanging: { projectId: string; taskId?: string; title?: string } = { projectId };
    if (taskId) {
      hanging.taskId = taskId;
    }
    const title = input.trim();
    if (title.length > 0) {
      hanging.title = title;
    }
    setBusy("starting");
    setEntries((current) => [
      ...current,
      { id: newChatId("usr"), kind: "user", text: title.length > 0 ? title : "去做" },
    ]);
    setInput("");
    try {
      const next = await handleIntent(
        client,
        startDirectIntentFromHanging(hanging),
        hanging.title ?? "去做",
        capabilities,
      );
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
        createWorkerInputFromWrite(entry.write),
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
      const proposal = entry.proposal ?? (await loadChatProposalForTurn(client, confirmed));
      const hadTaskPatch = proposalHasTaskTarget(proposal);
      const turnCompleted = turn?.status === "completed";
      setEntries((current) =>
        current.map((item) => {
          if (item.id !== entryId || item.kind !== "create_workflow") {
            return item;
          }
          if (!landed && !hadTaskPatch && !turnCompleted) {
            return {
              ...item,
              phase: "failed",
              ...(proposal ? { proposal } : {}),
              error: "确认后没有未发布 WorkflowDraft，也没有 Task patch。未把对话当成已执行。",
            };
          }
          const next: CreateWorkflowEntry = {
            ...item,
            phase: "landed",
            unpublished: true,
            sessionId: confirmed.id,
          };
          if (proposal) {
            next.proposal = proposal;
          }
          if (turn) {
            next.turnId = turn.id;
          }
          if (landed?.workflowDraftId) {
            next.workflowDraftId = landed.workflowDraftId;
          }
          if (landed?.workflowId) {
            next.workflowId = landed.workflowId;
          }
          const taskTarget = taskTargetsFromProposal(proposal)[0];
          if (taskTarget?.operation === "update") {
            next.taskId = taskTarget.targetId;
            next.definitionRevision = taskTarget.expectedRevision;
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
  const directDisabled = sendDisabled || !directReady;

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
        workers={workers}
        runs={runs}
        tasks={tasks}
        projectId={projectId}
        runId={runId}
        taskId={taskId}
        workerId={workerId}
        online={online}
        onProjectChange={setProjectId}
        onRunChange={setRunId}
        onTaskChange={setTaskId}
        onWorkerChange={onWorkerChange}
      />
      <Card testId={directReady ? "chat-direct-ready" : "chat-direct-closed"}>
        <Cluster>
          <Button
            testId="chat-direct-go"
            variant={directReady ? "primary" : "outline"}
            disabled={directDisabled}
            onClick={() => void onGoDirect()}
          >
            {busy === "starting" ? "启动中…" : "去做"}
          </Button>
          {directReady ? (
            <Badge tone="info">{intentKindLabel("start_direct")}</Badge>
          ) : (
            <Badge tone="warning">unsupported_capability</Badge>
          )}
        </Cluster>
        <Muted>{directReady ? DIRECT_READY_NOTE : DIRECT_UNSUPPORTED_NOTE}</Muted>
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
        <Field
          label="用语言描述要做的事"
          htmlFor="chat-intent"
          hint="分类以 Daemon 为准。认不出就问；空意图不会发送。"
        >
          <Textarea
            id="chat-intent"
            testId="chat-intent"
            rows={4}
            value={input}
            disabled={busy !== null}
            placeholder="例如：去做；现在改这个 bug；建一个更严的 reviewer；把这个角色改得更会写测试；请这个角色进项目；做一条发布流程；进度怎么样。"
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
  workers: readonly WorkerDto[];
  runs: readonly RunDto[];
  tasks: readonly TaskDto[];
  projectId: string;
  runId: string;
  taskId: string;
  workerId: string;
  online: boolean;
  onProjectChange: (projectId: string) => void;
  onRunChange: (runId: string) => void;
  onTaskChange: (taskId: string) => void;
  onWorkerChange: (workerId: string) => void;
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
            <option value="">
              未选择（创建角色可不选；请来 Team / 创建流程 / 问进度 / 交流工作 / 去做要选）
            </option>
            {props.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} · {project.id}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="角色" htmlFor="chat-worker">
          <Select
            id="chat-worker"
            testId="chat-worker-select"
            value={props.workerId}
            disabled={!props.online}
            onChange={(event) => props.onWorkerChange(event.target.value)}
          >
            <option value="">未选择（空闲写卡 / 请来 Team 对不上角色时先选）</option>
            {props.workers.map((worker) => (
              <option key={worker.id} value={worker.id}>
                {worker.name} · {worker.status} · {worker.id}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Task" htmlFor="chat-task">
          <Select
            id="chat-task"
            testId="chat-task-select"
            value={props.taskId}
            disabled={!props.online || !props.projectId}
            onChange={(event) => props.onTaskChange(event.target.value)}
          >
            <option value="">未选择（去做可空；空则先建项目内 ad-hoc Task）</option>
            {props.tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title} · {task.status} · {task.id}
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
      <Muted>
        {CREATE_WORKFLOW_NEEDS_PROJECT} {START_DIRECT_NEEDS_PROJECT} 没有 projectId / runId /
        workerId / taskId 时只问，不发写。
      </Muted>
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
          随时可说：去做、建角色、改卡片、请到项目、建流程、问进度、交流工作。分类结果不是完成态。认不出再问。
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
      {props.busy === "classify" ? <LoadingText>正在按 Daemon 分类结果落地…</LoadingText> : null}
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
          <p>{needContextMessage(entry.missing)}</p>
          <Muted>分类保留了原话，选好挂点后再发送。没有按字面默认交流工作。</Muted>
        </Card>
      );
    case "need_clarification":
      return (
        <Card testId="chat-need-clarification">
          <Badge tone="warning">需要澄清</Badge>
          <p>{entry.question}</p>
          <Muted>{NEED_CLARIFICATION_NOTE}</Muted>
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
    case "update_worker":
      return <UpdateWorkerCard entry={entry} />;
    case "invite_team":
      return <InviteTeamCard entry={entry} />;
    case "create_workflow":
      return (
        <WorkflowIntentCard
          entry={entry}
          confirming={props.busy === "confirming"}
          onConfirm={() => props.onConfirmWorkflow(entry.id)}
          onOpenCanvas={(path) => props.navigate(path)}
        />
      );
    case "start_direct":
      return <StartDirectCard entry={entry} />;
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
        <CardFields write={entry.write} />
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
      <CardFields write={entry.write} />
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

function CardFields(props: { write: WorkerProposalWrite }): ReactNode {
  return (
    <>
      <Muted>
        {CARD_FIELD_LABELS.who}：{props.write.who ?? "（空）"}
      </Muted>
      <Muted>
        {CARD_FIELD_LABELS.how}：{props.write.how ?? "（空）"}
      </Muted>
      <Muted>
        {CARD_FIELD_LABELS.skills}：{props.write.skills ?? "（空）"}
      </Muted>
    </>
  );
}

function UpdateWorkerCard(props: { entry: UpdateWorkerEntry }): ReactNode {
  const { entry } = props;
  if (entry.phase === "failed") {
    return (
      <Card testId="chat-update-worker-failed">
        <Badge tone="danger">{intentKindLabel("update_worker")}</Badge>
        <ErrorText>{entry.error}</ErrorText>
        <Muted>没有创建 Task/Run，也没有收件箱。</Muted>
      </Card>
    );
  }
  return (
    <Card testId="chat-update-worker-landed">
      <Badge tone="muted">{intentKindLabel("update_worker")}</Badge>
      <p>
        {entry.forkedFromWorkerVersionId ? UPDATE_WORKER_FORKED_NOTE : UPDATE_WORKER_LANDED_NOTE}
      </p>
      <Muted>
        {CARD_FIELD_LABELS[entry.cardField]} · Worker {entry.workerId} · 草稿 {entry.draftId}
        {entry.forkedFromWorkerVersionId ? ` · fork 自 ${entry.forkedFromWorkerVersionId}` : ""}
      </Muted>
    </Card>
  );
}

function InviteTeamCard(props: { entry: InviteTeamEntry }): ReactNode {
  const { entry } = props;
  if (entry.phase === "failed") {
    return (
      <Card testId="chat-invite-failed">
        <Badge tone="danger">{intentKindLabel("invite_team")}</Badge>
        <ErrorText>{entry.error}</ErrorText>
        <Muted>没有把请来画成已发布员工或已在执行。</Muted>
      </Card>
    );
  }
  return (
    <Card testId="chat-invite-landed">
      <Badge tone="muted">{intentKindLabel("invite_team")}</Badge>
      <p>{entry.alreadyMember ? INVITE_ALREADY_ON_TEAM : INVITE_TEAM_LANDED_NOTE}</p>
      <Muted>
        项目 {entry.projectId} · WorkerVersion {entry.workerVersionId}
        {entry.teamId ? ` · Team ${entry.teamId}` : ""}
        {entry.teamVersionId ? ` · Version ${entry.teamVersionId}` : ""}
      </Muted>
      <Muted>{INVITE_TEAM_UNPUBLISHED_NOTE}</Muted>
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
  const taskTargets = taskTargetsFromProposal(entry.proposal);
  const hasTaskPatch = taskTargets.length > 0;
  if (entry.phase === "failed") {
    return (
      <Card testId={hasTaskPatch ? "chat-task-patch-failed" : "chat-workflow-failed"}>
        <Badge tone="danger">未落地</Badge>
        <ErrorText>{entry.error}</ErrorText>
        <Muted>{hasTaskPatch ? TASK_PATCH_LANDED_NOTE : TURN_CONFIRMED_IS_NOT_DONE}</Muted>
      </Card>
    );
  }
  if (entry.phase === "landed") {
    if (hasTaskPatch && !entry.workflowDraftId && !entry.workflowId) {
      return (
        <Card testId="chat-task-patch-landed">
          <Badge tone="muted">Task patch 已确认</Badge>
          <p>{TASK_PATCH_LANDED_NOTE}</p>
          <TaskPatchTargets targets={taskTargets} />
          <Muted>
            项目 {entry.projectId}
            {entry.taskId ? ` · Task ${entry.taskId}` : ""}
            {entry.definitionRevision !== undefined
              ? ` · expectedRevision ${entry.definitionRevision}`
              : ""}
          </Muted>
        </Card>
      );
    }
    if (!entry.workflowDraftId && !entry.workflowId) {
      return (
        <Card testId="chat-task-patch-landed">
          <Badge tone="muted">确认已落地</Badge>
          <p>{TASK_PATCH_LANDED_NOTE}</p>
          <Muted>
            项目 {entry.projectId}
            {entry.taskId ? ` · Task ${entry.taskId}` : ""}
          </Muted>
          <Muted>{TURN_CONFIRMED_IS_NOT_DONE}</Muted>
        </Card>
      );
    }
    const canvasPath = landedDraftCanvasPath({
      unpublished: true,
      ...(entry.workflowDraftId ? { workflowDraftId: entry.workflowDraftId } : {}),
      ...(entry.workflowId ? { workflowId: entry.workflowId } : {}),
    });
    return (
      <Card testId="chat-workflow-landed">
        <Badge tone="muted">未发布 WorkflowDraft</Badge>
        <p>{CREATE_WORKFLOW_LANDED_NOTE}</p>
        {hasTaskPatch ? (
          <>
            <Muted>{TASK_PATCH_LANDED_NOTE}</Muted>
            <TaskPatchTargets targets={taskTargets} />
          </>
        ) : null}
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
  if (hasTaskPatch) {
    return (
      <Card title="确认 Task patch" testId="chat-task-patch-proposal">
        <Muted>{TASK_PATCH_PROPOSAL_NOTE}</Muted>
        <p>{entry.summary}</p>
        <TaskPatchTargets targets={taskTargets} />
        <Muted>
          项目 {entry.projectId}
          {entry.sessionId ? ` · 会话 ${entry.sessionId}` : ""}
        </Muted>
        <Button
          testId="chat-confirm-task-patch"
          variant="primary"
          disabled={props.confirming}
          onClick={props.onConfirm}
        >
          {props.confirming ? "确认中…" : "确认 Task patch"}
        </Button>
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

function TaskPatchTargets(props: {
  targets: ReturnType<typeof taskTargetsFromProposal>;
}): ReactNode {
  if (props.targets.length === 0) {
    return null;
  }
  return (
    <>
      {props.targets.map((target, index) => (
        <Muted key={`${target.patchRef}-${index}`}>
          targetType=task · {target.operation}
          {target.operation === "update"
            ? ` · taskId ${target.targetId} · expectedRevision ${target.expectedRevision}`
            : ""}
          {` · patchRef ${target.patchRef}`}
        </Muted>
      ))}
    </>
  );
}

function StartDirectCard(props: { entry: StartDirectEntry }): ReactNode {
  const { entry } = props;
  if (entry.phase === "failed") {
    return (
      <Card testId="chat-direct-failed">
        <Badge tone="danger">{intentKindLabel("start_direct")}</Badge>
        <ErrorText>{entry.error ?? entry.detail}</ErrorText>
        <Muted>没有把气泡画成 completed，也没有发明 :direct 路由。</Muted>
      </Card>
    );
  }
  return (
    <Card testId="chat-direct-started">
      <Badge tone="info">{intentKindLabel("start_direct")}</Badge>
      <p>{START_DIRECT_LANDED_NOTE}</p>
      <Muted>
        项目 {entry.projectId}
        {entry.taskId ? ` · Task ${entry.taskId}` : ""}
        {entry.runId ? ` · Run ${entry.runId}` : ""}
        {entry.runStatus ? ` · ${entry.runStatus}` : ""}
        {entry.createdAdHocTask ? " · 经 POST /projects/{id}/tasks" : " · 复用已有 Task"}
      </Muted>
      <Notice tone="info">没有 Artifact / evaluation pass。不会把这次启动画成做完。</Notice>
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
  hanging: {
    text: string;
    projectId: string;
    runId: string;
    taskId: string;
    workerId: string;
    workerVersionId: string;
  },
): Promise<ChatClassifyResultDto> {
  const body: ChatClassifyInput = { text: hanging.text };
  if (hanging.projectId) {
    body.projectId = hanging.projectId;
  }
  if (hanging.runId) {
    body.runId = hanging.runId;
  }
  if (hanging.taskId) {
    body.taskId = hanging.taskId;
  }
  if (hanging.workerId) {
    body.workerId = hanging.workerId;
  }
  if (hanging.workerVersionId) {
    body.workerVersionId = hanging.workerVersionId;
  }
  return client.classifyChatIntent(body, writeCommandOptions());
}

async function dispatchResult(
  client: DesktopClient,
  result: ChatClassifyResultDto,
  text: string,
  capabilities: CapabilitiesDto | null,
  hanging: { projectId: string; taskId: string },
): Promise<ChatEntry[]> {
  const unsupported = classifyUnsupportedAction(result);
  if (result.outcome === "unsupported" && unsupported === "im") {
    return [
      {
        id: newChatId("uns"),
        kind: "unsupported",
        action: "im",
        code: "unsupported_capability",
      },
    ];
  }
  if (result.outcome === "unsupported" && unsupported === "direct") {
    if (!isDirectCapabilityReady(capabilities?.orchestration?.direct)) {
      return [
        {
          id: newChatId("uns"),
          kind: "unsupported",
          action: "direct",
          code: "unsupported_capability",
        },
      ];
    }
    if (!hanging.projectId) {
      return [
        {
          id: newChatId("need"),
          kind: "need_context",
          missing: "projectId",
          text,
        },
      ];
    }
    const hangingIntent: { projectId: string; taskId?: string; title?: string } = {
      projectId: hanging.projectId,
    };
    if (hanging.taskId) {
      hangingIntent.taskId = hanging.taskId;
    }
    if (text.trim().length > 0) {
      hangingIntent.title = text.trim();
    }
    return handleIntent(client, startDirectIntentFromHanging(hangingIntent), text, capabilities);
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
  if (result.outcome === "need_clarification") {
    return [
      {
        id: newChatId("ask"),
        kind: "need_clarification",
        question: result.question,
      },
    ];
  }
  if (result.outcome !== "intent") {
    return [{ id: newChatId("err"), kind: "error", detail: "分类结果无法识别，没有写入对象。" }];
  }
  const entries: ChatEntry[] = [];
  for (const intent of classifiedIntents(result)) {
    entries.push(...(await handleIntent(client, intent, text, capabilities)));
  }
  return entries;
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
          write: createWorkerWriteFromIntent(intent, text),
          phase: "proposal",
        },
      ];
    case "update_worker":
      return landUpdateWorkerEntry(client, intent, text);
    case "invite_team":
      return landInviteTeamEntry(client, intent);
    case "create_workflow":
      return startWorkflowAuthoring(client, intent.projectId, intent.summary ?? text);
    case "query_progress": {
      const projection = await client.getProjectProgress(intent.projectId);
      return [{ id: newChatId("prg"), kind: "progress", projection }];
    }
    case "discuss_work":
      return sendDiscussWork(client, intent, text, capabilities);
    case "start_direct":
      return landStartDirectEntry(client, intent, capabilities);
  }
}

async function landStartDirectEntry(
  client: DesktopClient,
  intent: Extract<ChatIntentDto, { kind: "start_direct" }>,
  capabilities: CapabilitiesDto | null,
): Promise<ChatEntry[]> {
  if (!isDirectCapabilityReady(capabilities?.orchestration?.direct)) {
    return [
      {
        id: newChatId("uns"),
        kind: "unsupported",
        action: "direct",
        code: "unsupported_capability",
      },
    ];
  }
  try {
    const landed = await landStartDirect(client, intent);
    return [
      {
        id: newChatId("dir"),
        kind: "start_direct",
        projectId: landed.projectId,
        phase: "started",
        taskId: landed.taskId,
        runId: landed.run.id,
        runStatus: landed.run.status,
        createdAdHocTask: landed.createdAdHocTask,
        detail: START_DIRECT_LANDED_NOTE,
      },
    ];
  } catch (reason: unknown) {
    return [
      {
        id: newChatId("dir"),
        kind: "start_direct",
        projectId: intent.projectId,
        phase: "failed",
        ...(intent.taskId ? { taskId: intent.taskId } : {}),
        detail: errorMessage(reason),
        error: errorMessage(reason),
      },
    ];
  }
}

async function landUpdateWorkerEntry(
  client: DesktopClient,
  intent: Extract<ChatIntentDto, { kind: "update_worker" }>,
  text: string,
): Promise<ChatEntry[]> {
  try {
    const landed = await landIdleWorkerRemark(client, intent, text);
    const entry: UpdateWorkerEntry = {
      id: newChatId("upd"),
      kind: "update_worker",
      cardField: landed.cardField,
      workerId: landed.workerId,
      draftId: landed.draft.id,
      phase: "landed",
    };
    if (landed.forkedFromWorkerVersionId !== undefined) {
      entry.forkedFromWorkerVersionId = landed.forkedFromWorkerVersionId;
    }
    return [entry];
  } catch (reason: unknown) {
    return [
      {
        id: newChatId("upd"),
        kind: "update_worker",
        cardField: intent.cardField,
        workerId: intent.workerId,
        draftId: intent.workerDraftId ?? "",
        phase: "failed",
        error: errorMessage(reason),
      },
    ];
  }
}

async function landInviteTeamEntry(
  client: DesktopClient,
  intent: Extract<ChatIntentDto, { kind: "invite_team" }>,
): Promise<ChatEntry[]> {
  try {
    const landed = await landInviteTeam(client, intent);
    const entry: InviteTeamEntry = {
      id: newChatId("inv"),
      kind: "invite_team",
      projectId: landed.projectId,
      workerVersionId: landed.workerVersionId,
      phase: "landed",
      teamId: landed.teamId,
      teamVersionId: landed.teamVersionId,
      alreadyMember: landed.alreadyMember,
    };
    return [entry];
  } catch (reason: unknown) {
    return [
      {
        id: newChatId("inv"),
        kind: "invite_team",
        projectId: intent.projectId,
        workerVersionId: intent.workerVersionId,
        phase: "failed",
        error: errorMessage(reason),
      },
    ];
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
    if (!isAuthoringProposalReady(session) || !turn) {
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
    const proposal = await loadChatProposalForTurn(client, session);
    const entry: CreateWorkflowEntry = {
      id: newChatId("wf"),
      kind: "create_workflow",
      projectId,
      summary,
      phase: "proposal",
      sessionId: session.id,
      turnId: turn.id,
    };
    if (proposal !== null) {
      entry.proposal = proposal;
    }
    return [entry];
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
