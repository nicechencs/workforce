import { useCallback, useEffect, useState } from "react";
import type { CapabilitiesDto, DesktopClient, RunDto, TaskDto } from "@workforce/desktop-client";

import type { FeaturePageProps } from "../contract.js";
import { useWorkforceClient } from "../hooks.js";
import {
  commandOptions,
  errorMessage,
  isCommandAccepted,
  isRevisionConflict,
} from "../projects/command.js";
import {
  OrchestrationModeControl,
  DEFAULT_MODE,
  probeOrchestrationSupport,
  resolveSelectedMode,
  type OrchestrationMode,
} from "../orchestration/index.js";
import { defaultCapabilities, taskDependencyLabel } from "../projects/model.js";
import {
  badgeStyle,
  buttonStyle,
  cardStyle,
  errorStyle,
  listItemStyle,
  listStyle,
  mutedStyle,
  pageStyle,
  rowStyle,
  titleStyle,
  warningStyle,
} from "../projects/ui.js";
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
  const [capabilities, setCapabilities] = useState<CapabilitiesDto>(defaultCapabilities());
  const [orchestrationMode, setOrchestrationMode] = useState<OrchestrationMode>(DEFAULT_MODE);

  const reload = useCallback(async () => {
    const loaded = await client.getTask(taskId);
    setTask(loaded);
    const page = await client.listRuns({ taskId });
    setRuns(sortRunsNewestFirst(page.items));
    const caps = await client.getCapabilities().catch(() => defaultCapabilities());
    setCapabilities(caps);
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
      <main style={pageStyle}>
        <div style={errorStyle}>{error}</div>
      </main>
    );
  }
  if (!task) {
    return (
      <main style={pageStyle}>
        <p style={mutedStyle}>加载任务…</p>
      </main>
    );
  }

  const actions = visibleTaskActions(task);

  return (
    <main style={pageStyle}>
      <p>
        <button
          type="button"
          style={buttonStyle("secondary")}
          onClick={() => navigate(`/projects/${projectId || task.projectId}`)}
        >
          返回项目
        </button>
      </p>
      <h1 style={titleStyle}>{task.title}</h1>
      <div style={rowStyle}>
        <span style={badgeStyle(task.status === "failed" ? "danger" : "muted")}>
          {taskHeadlineStatus(task)}
        </span>
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={!action.enabled || busy !== null}
            style={buttonStyle(action.kind, !action.enabled || busy !== null)}
            onClick={() => void runAction(action.id)}
          >
            {action.label}
          </button>
        ))}
        {conflict ? (
          <button type="button" style={buttonStyle("secondary")} onClick={() => void reload()}>
            刷新
          </button>
        ) : null}
      </div>
      {error ? <div style={conflict ? warningStyle : errorStyle}>{error}</div> : null}
      <OrchestrationModeControl
        selected={resolveSelectedMode(
          orchestrationMode,
          probeOrchestrationSupport({ capabilities }),
        )}
        probe={probeOrchestrationSupport({ capabilities })}
        disabled={busy !== null}
        onChange={setOrchestrationMode}
      />
      <section style={cardStyle}>
        <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>任务</h2>
        <p>{task.objective}</p>
        <p style={mutedStyle}>
          任务状态：{taskStatusLabel(task.status)} · definitionRevision {task.definitionRevision} ·
          generation {task.generation} · attempt {task.attempt}
        </p>
        <p style={mutedStyle} data-testid="task-depends-on">
          {taskDependencyLabel(task)}
        </p>
        <p style={mutedStyle}>{taskKindNote()}</p>
      </section>
      <section style={cardStyle}>
        <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>运行记录</h2>
        {runs.length === 0 ? (
          <p style={mutedStyle}>还没有 Run。</p>
        ) : (
          <ul style={listStyle}>
            {runs.map((run) => (
              <li key={run.id} style={listItemStyle} onClick={() => navigate(`/runs/${run.id}`)}>
                <strong>{run.id}</strong>
                <div style={mutedStyle}>
                  运行状态：{runStatusLabel(run.status)}
                  {run.cancelRequested && run.status !== "cancelled" ? " · 取消中" : ""} · attempt{" "}
                  {run.attempt}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export function TasksPage(props: FeaturePageProps) {
  const client = useWorkforceClient();
  return <TaskDetailPage {...props} client={client} />;
}
