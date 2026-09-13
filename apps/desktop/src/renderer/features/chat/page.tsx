import { useEffect, useState, type ReactNode } from "react";
import type { ProjectDto, RunDto, TaskDto, WorkerDto } from "@workforce/desktop-client";

import { useOptionalWorkforceContext } from "../../app/workforce-context.js";
import {
  Badge,
  Button,
  Card,
  Cluster,
  ErrorText,
  Field,
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
  landedWorkflowDraft,
  lastAuthoringTurn,
  loadChatProposalForTurn,
  proposalHasTaskTarget,
  taskTargetsFromProposal,
} from "./authoring.js";
import type { BusyAction, ChatEntry, CreateWorkerEntry, CreateWorkflowEntry, ErrorEntry } from "./entries.js";
import { classify, dispatchResult, handleIntent } from "./intent.js";
import {
  CHAT_NOT_AUTHORING_ONLY,
  CHAT_NOT_IM,
  CHAT_SUBTITLE,
  CREATE_WORKFLOW_NEEDS_PROJECT,
  DIRECT_READY_NOTE,
  DIRECT_UNSUPPORTED_NOTE,
  errorCode,
  errorMessage,
  intentKindLabel,
  isActiveRun,
  isDirectCapabilityReady,
  isEmptyChatIntent,
  newChatId,
  roleLibraryPath,
  selectablePublishedVersion,
  START_DIRECT_NEEDS_PROJECT,
  startDirectIntentFromHanging,
  writeCommandOptions,
  createWorkerInputFromWrite,
} from "./model.js";
import { Transcript } from "./transcript.js";

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
