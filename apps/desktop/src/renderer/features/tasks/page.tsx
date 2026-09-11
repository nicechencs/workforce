import { useCallback, useEffect, useState } from "react";
import type { DesktopClient, RunDto, TaskDto } from "@workforce/desktop-client";

import {
  Badge,
  Button,
  Card,
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
import { taskDependencyLabel } from "../projects/model.js";
import {
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
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState<TaskActionId | null>(null);

  const reload = useCallback(async () => {
    const loaded = await client.getTask(taskId);
    setTask(loaded);
    const page = await client.listRuns({ taskId });
    setRuns(sortRunsNewestFirst(page.items));
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

  return (
    <Page
      title={task.title}
      actions={
        <Button onClick={() => navigate(`/projects/${projectId || task.projectId}`)}>
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
    </Page>
  );
}

export function TasksPage(props: FeaturePageProps) {
  const client = useWorkforceClient();
  return <TaskDetailPage {...props} client={client} />;
}
