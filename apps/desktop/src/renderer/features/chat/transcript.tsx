import type { ProjectProgressProjectionDto } from "@workforce/desktop-client";
import type { ReactNode } from "react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  LoadingText,
  Muted,
  Notice,
} from "../../components/ui.js";
import { taskTargetsFromProposal } from "./authoring.js";
import type {
  BusyAction,
  ChatEntry,
  CreateWorkerEntry,
  CreateWorkflowEntry,
  InviteTeamEntry,
  StartDirectEntry,
  UpdateWorkerEntry,
} from "./entries.js";
import {
  CARD_FIELD_LABELS,
  CREATE_WORKER_LANDED_NOTE,
  CREATE_WORKER_PROPOSAL_NOTE,
  CREATE_WORKFLOW_LANDED_NOTE,
  CREATE_WORKFLOW_PROPOSAL_NOTE,
  hasCompletionFact,
  intentKindLabel,
  INVITE_ALREADY_ON_TEAM,
  INVITE_TEAM_LANDED_NOTE,
  INVITE_TEAM_UNPUBLISHED_NOTE,
  landedDraftCanvasPath,
  NEED_CLARIFICATION_NOTE,
  needContextMessage,
  PROGRESS_FACT_NOTE,
  progressEmptyMessage,
  roleLibraryWorkerPath,
  START_DIRECT_LANDED_NOTE,
  TASK_PATCH_LANDED_NOTE,
  TASK_PATCH_PROPOSAL_NOTE,
  TURN_CONFIRMED_IS_NOT_DONE,
  UPDATE_WORKER_FORKED_NOTE,
  UPDATE_WORKER_LANDED_NOTE,
  type WorkerProposalWrite,
} from "./model.js";

export function Transcript(props: {
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
          onOpenLibrary={(path) => props.navigate(path)}
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
  onOpenLibrary: (path: string) => void;
}): ReactNode {
  const { entry } = props;
  if (entry.phase === "landed" && entry.worker) {
    const worker = entry.worker;
    return (
      <Card testId="chat-worker-landed">
        <Badge tone="muted">未发布草稿</Badge>
        <p>{CREATE_WORKER_LANDED_NOTE}</p>
        <Muted>
          {worker.name} · {worker.id} · status {worker.status}
        </Muted>
        <CardFields write={entry.write} />
        <Button
          testId="chat-open-role-library-after"
          variant="primary"
          onClick={() => props.onOpenLibrary(roleLibraryWorkerPath(worker.id))}
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
