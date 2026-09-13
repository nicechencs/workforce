import { useCallback, useEffect, useState } from "react";
import type {
  ApprovalDto,
  ArtifactDto,
  DesktopClient,
  RunDto,
  TaskDto,
} from "@workforce/desktop-client";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  List,
  ListRow,
  LoadingText,
  Muted,
  Page,
} from "../../components/ui.js";
import type { FeaturePageProps } from "../contract.js";
import { useWorkforceClient } from "../hooks.js";
import {
  commandOptions,
  errorMessage,
  isCommandAccepted,
  isRevisionConflict,
} from "../projects/command.js";
import { pinnedArtifactVersion, taskDependencyLabel } from "../projects/model.js";
import {
import {
  EVALUATION_PENDING,
  EVALUATION_ROW,
  EVALUATION_UNAVAILABLE,
  FIELD_UNRETURNED,
  projectTasksPath,
  RETRY_NEW_RUN_NOTE,
  runStatusLabel,
  sortRunsNewestFirst,
  taskHeadlineStatus,
  taskKindNote,
  taskStatusLabel,
  visibleTaskActions,
  type TaskActionId,
} from "./model.js";

export function TaskDetailPage(props: FeaturePageProps & { client: DesktopClient }) {
  const { client, params, navigate } = props;
  const taskId = params.taskId ?? "";
  const projectId = params.projectId ?? "";
  const [task, setTask] = useState<TaskDto | null>(null);
  const [runs, setRuns] = useState<RunDto[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactDto[]>([]);
  const [approvals, setApprovals] = useState<ApprovalDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<TaskActionId | null>(null);

  const reload = useCallback(async () => {
    const loaded = await client.getTask(taskId);
    setTask(loaded);
    const page = await client.listRuns({ taskId });
    setRuns(sortRunsNewestFirst(page.items));
    setArtifacts(await listOrEmpty(() => client.listArtifacts({ taskId: loaded.id })));
    setApprovals(await listOrEmpty(() => client.listApprovals({ taskId: loaded.id })));
  }, [client, taskId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await reload();
        if (!cancelled) {
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(errorMessage(caught));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  async function runAction(id: TaskActionId) {
    if (!task) {
      return;
    }
    setBusy(id);
    setError(null);
    setConflict(false);
    try {
      const opts = commandOptions(task.stateRevision);
      if (id === "retry") {
        const result = await client.retryTask(task.id, opts);
        setTask(result.task);
      } else {
        const result = await client.cancelTask(task.id, opts);
        if (isCommandAccepted(result)) {
          setTask({ ...task, cancelRequested: true });
        } else {
          setTask(result);
        }
      }
      await reload();
    } catch (caught) {
      setConflict(isRevisionConflict(caught));
      setError(
        isRevisionConflict(caught)
          ? "版本冲突（412 revision_conflict）。已保留当前页面，请刷新后再试。"
          : errorMessage(caught),
      );
    } finally {
      setBusy(null);
    }
  }

  if (error && !task) {
    return (
      <Page title="任务">
        <ErrorText>{error}</ErrorText>
      </Page>
    );
  }
  if (!task) {
    return (
      <Page title="任务">
        <LoadingText>加载任务…</LoadingText>
      </Page>
    );
  }

  const actions = visibleTaskActions(task);
  const backProjectId = projectId || task.projectId;

  return (
    <Page
      title={task.title}
      subtitle="Task 不是 Run。完成只看产物与判定。"
      actions={
        <Button variant="outline" onClick={() => navigate(projectTasksPath(backProjectId))}>
          返回项目
        </Button>
      }
    >
      <div className="wf-chrome-row">
        <Badge tone={task.status === "failed" ? "danger" : "muted"}>
          {taskHeadlineStatus(task)}
        </Badge>
        {actions.map((action) => (
          <Button
            key={action.id}
            variant={action.kind === "primary" ? "primary" : "secondary"}
            disabled={!action.enabled || busy !== null}
            onClick={() => void runAction(action.id)}
          >
            {action.label}
          </Button>
        ))}
        {conflict ? <Button onClick={() => void reload()}>刷新</Button> : null}
      </div>
      <ErrorText>{error}</ErrorText>
      <Card title="任务">
        <p>{task.objective}</p>
        <Muted>
          任务状态：{taskStatusLabel(task.status)} · definitionRevision {task.definitionRevision} ·
          generation {task.generation} · attempt {task.attempt}
        </Muted>
        <Muted>
          <span data-testid="task-depends-on">{taskDependencyLabel(task)}</span>
        </Muted>
        <Muted>{taskKindNote()}</Muted>
        {actions.some((action) => action.id === "retry") ? <Muted>{RETRY_NEW_RUN_NOTE}</Muted> : null}
      </Card>
      <Card title="验收与说明">
        <Muted>验收条件：{FIELD_UNRETURNED}</Muted>
        <Muted>instructions：{FIELD_UNRETURNED}</Muted>
      </Card>
      <Card title="分配">
        <Muted>WorkerVersion：{FIELD_UNRETURNED}</Muted>
        <Muted>卡片三字段：{FIELD_UNRETURNED}</Muted>
        <Muted>职责标签：{task.role?.trim() ? task.role : FIELD_UNRETURNED}</Muted>
      </Card>
      <Card title="Placement / Runtime">
        <Muted>Placement：{FIELD_UNRETURNED}</Muted>
        <Muted>执行模式：{FIELD_UNRETURNED}</Muted>
        <Muted>只读 intent；没有 capability 不画成功切换。</Muted>
      </Card>
      <Card title="运行记录">
        {runs.length === 0 ? (
          <Muted>还没有 Run。</Muted>
        ) : (
          <List>
            {runs.map((run) => (
              <ListRow
                key={run.id}
                title={run.id}
                meta={`运行状态：${runStatusLabel(run.status)}${
                  run.cancelRequested && run.status !== "cancelled" ? " · 取消中" : ""
                } · attempt ${run.attempt}`}
                onClick={() => navigate(`/runs/${run.id}`)}
              />
            ))}
          </List>
        )}
      </Card>
      <Card title="产物">
        {artifacts.length === 0 ? (
          <Muted>还没有精确版本产物。完成不能看聊天或 Run 成功。</Muted>
        ) : (
          <List>
            {artifacts.map((artifact) => {
              const version = pinnedArtifactVersion(artifact);
              if (version === null) {
                return (
                  <ListRow
                    key={artifact.id}
                    title={artifact.logicalName}
                    meta={`${artifact.kind} · 无版本，不能打开 latest`}
                  />
                );
              }
              return (
                <ListRow
                  key={artifact.id}
                  title={artifact.logicalName}
                  meta={`${artifact.kind} · ${version.id}`}
                  onClick={() => navigate(`/artifacts/${artifact.id}/versions/${version.id}`)}
                />
              );
            })}
          </List>
        )}
      </Card>
      <Card title="判定">
        {artifacts.length === 0 ? (
          <EmptyState title={EVALUATION_PENDING}>{EVALUATION_UNAVAILABLE}</EmptyState>
        ) : (
          <>
            <List>
              {artifacts.map((artifact) => {
                const version = pinnedArtifactVersion(artifact);
                return (
                  <ListRow
                    key={artifact.id}
                    title={artifact.logicalName}
                    meta={`${version === null ? "无精确版本" : version.id} · ${EVALUATION_ROW}`}
                  />
                );
              })}
            </List>
            <Muted>{EVALUATION_UNAVAILABLE}</Muted>
          </>
        )}
      </Card>
      <Card title="审批">
        {approvals.length === 0 ? (
          <Muted>没有绑定这条 Task 的审批。</Muted>
        ) : (
          <List>
            {approvals.map((approval) => (
              <ListRow
                key={approval.id}
                title={approval.gate}
                meta={approval.status}
                onClick={() => navigate(`/approvals/${approval.id}`)}
              />
            ))}
          </List>
        )}
      </Card>
    </Page>
  );
}

export function TasksPage(props: FeaturePageProps) {
  const client = useWorkforceClient();
  return <TaskDetailPage {...props} client={client} />;
}

async function listOrEmpty<T>(load: () => Promise<{ items: T[] }>): Promise<T[]> {
  try {
    return (await load()).items;
  } catch {
    return [];
  }
}
