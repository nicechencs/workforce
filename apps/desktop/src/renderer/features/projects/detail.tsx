import { useCallback, useEffect, useState } from "react";
import type {
  CapabilitiesDto,
  DesktopClient,
  ProjectDto,
  TaskDto,
} from "@workforce/desktop-client";
import type { WorkspaceGrant } from "@workforce/ui";

import type { FeaturePageProps } from "../contract.js";
import { asCatalogClient, getPreloadApi, hasCatalogMethod } from "../hooks.js";
import { PRESET_TEAM, PRESET_TEAM_ID } from "../teams/model.js";
import { sortTasksForDag, taskStatusLabel } from "../tasks/model.js";
import { commandOptions, errorMessage, isCommandAccepted, isRevisionConflict } from "./command.js";
import {
  applyFormFailure,
  applyProjectRefresh,
  budgetPlaceholder,
  defaultCapabilities,
  defaultDraftSelection,
  pendingApprovalCount,
  projectEditForm,
  projectStatusLabel,
  publicWorkspaceLabel,
  statusBadgeTone,
  visibleProjectActions,
  type ProjectActionId,
  type ProjectEditForm,
} from "./model.js";
import {
  badgeStyle,
  buttonStyle,
  cardStyle,
  errorStyle,
  inputStyle,
  labelStyle,
  listItemStyle,
  listStyle,
  mutedStyle,
  rowStyle,
  titleStyle,
  warningStyle,
} from "./ui.js";

export function ProjectDetail(props: FeaturePageProps & { client: DesktopClient }) {
  const { client, params, navigate } = props;
  const projectId = params.projectId ?? "";
  const [project, setProject] = useState<ProjectDto | null>(null);
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [approvals, setApprovals] = useState(0);
  const [capabilities, setCapabilities] = useState<CapabilitiesDto>(defaultCapabilities());
  const [grant, setGrant] = useState<WorkspaceGrant | null>(null);
  const [budget, setBudget] = useState<string>(budgetPlaceholder(null));
  const [edit, setEdit] = useState<ProjectEditForm>(projectEditForm({ name: "", objective: "" }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ProjectActionId | null>(null);
  const selection = defaultDraftSelection();

  const reload = useCallback(
    async (keepInput: boolean) => {
      const loaded = await client.getProject(projectId);
      setProject(loaded);
      setEdit((current) =>
        keepInput ? applyProjectRefresh(current, loaded, true) : projectEditForm(loaded),
      );
      const [taskPage, approvalPage, caps] = await Promise.all([
        client.listTasks({ projectId }),
        client.listApprovals({ projectId }),
        client.getCapabilities().catch(() => defaultCapabilities()),
      ]);
      setTasks(sortTasksForDag(taskPage.items));
      setApprovals(pendingApprovalCount(approvalPage.items));
      setCapabilities(caps);
      const catalog = asCatalogClient(client);
      if (hasCatalogMethod(catalog, "getProjectBudget")) {
        try {
          setBudget(budgetPlaceholder(await catalog.getProjectBudget(projectId)));
        } catch {
          setBudget(budgetPlaceholder(null));
        }
      } else {
        setBudget(budgetPlaceholder(null));
      }
    },
    [client, projectId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await reload(false);
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

  async function runAction(id: ProjectActionId) {
    if (!project) {
      return;
    }
    setBusy(id);
    setError(null);
    try {
      const opts = commandOptions(project.stateRevision);
      if (id === "startPlanning") {
        const next = await client.startPlanning(project.id, opts);
        setProject(next);
      } else if (id === "confirmPlan") {
        const versionId = project.planArtifactVersionId;
        if (!versionId) {
          setError("还没有可确认的计划产物版本。");
          return;
        }
        const next = await client.confirmPlan(
          project.id,
          { planArtifactVersionId: versionId },
          opts,
        );
        setProject(next);
      } else if (id === "startProject") {
        const next = await client.startProject(project.id, opts);
        setProject(next);
      } else if (id === "cancel") {
        const result = await client.cancelProject(project.id, opts);
        if (isCommandAccepted(result)) {
          setProject({ ...project, cancelRequested: true });
        } else {
          setProject(result);
        }
      }
      await reload(true);
    } catch (caught) {
      if (isRevisionConflict(caught)) {
        setEdit((current) => applyFormFailure(current, caught));
      }
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit() {
    if (!project) {
      return;
    }
    setEdit((current) => ({ ...current, submitting: true, error: null }));
    try {
      const next = await client.patchProject(
        project.id,
        { name: edit.name, objective: edit.objective },
        commandOptions(project.stateRevision),
      );
      setProject(next);
      setEdit(projectEditForm(next));
    } catch (caught) {
      setEdit((current) => applyFormFailure(current, caught));
      setError(errorMessage(caught));
    }
  }

  async function bindWorkspace() {
    const api = getPreloadApi();
    if (!api) {
      setError("无法选择目录：预加载桥未就绪。");
      return;
    }
    const picked = await api.workspace.pickDirectory();
    if (!picked.ok) {
      return;
    }
    const catalog = asCatalogClient(client);
    if (project && hasCatalogMethod(catalog, "createProjectWorkspace")) {
      try {
        await catalog.createProjectWorkspace(
          project.id,
          { authorizationRef: picked.grant.authorizationId },
          commandOptions(project.stateRevision),
        );
        await reload(true);
        setGrant(picked.grant);
      } catch (caught) {
        setError(errorMessage(caught));
      }
      return;
    }
    setGrant(picked.grant);
  }

  if (error && !project) {
    return <div style={errorStyle}>{error}</div>;
  }
  if (!project) {
    return <p style={mutedStyle}>加载项目…</p>;
  }

  const workspaceBound = grant !== null;
  const actionInput = {
    status: project.status,
    cancelRequested: project.cancelRequested,
    workspaceBound,
    teamSelected: selection.teamId === PRESET_TEAM_ID,
    runtimeSelected: selection.runtimeId === "mock",
    capabilities: capabilities.project,
    ...(project.planArtifactVersionId !== undefined
      ? { planArtifactVersionId: project.planArtifactVersionId }
      : {}),
  };
  const actions = visibleProjectActions(actionInput);
  const statusLabel = projectStatusLabel(project);

  return (
    <div>
      <p style={mutedStyle}>
        <button
          type="button"
          style={buttonStyle("secondary")}
          onClick={() => navigate("/projects")}
        >
          返回项目
        </button>
      </p>
      <h1 style={titleStyle}>{project.name}</h1>
      <div style={rowStyle}>
        <span
          data-testid="project-status"
          style={badgeStyle(statusBadgeTone(project.status, project.cancelRequested))}
        >
          {statusLabel}
        </span>
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={!action.enabled || busy !== null}
            style={buttonStyle(action.kind, !action.enabled || busy !== null)}
            data-testid={`project-action-${action.id}`}
            onClick={() => void runAction(action.id)}
          >
            {action.label}
          </button>
        ))}
        {edit.needsRefresh ? (
          <button type="button" style={buttonStyle("secondary")} onClick={() => void reload(true)}>
            刷新
          </button>
        ) : null}
      </div>
      {error ? <div style={edit.needsRefresh ? warningStyle : errorStyle}>{error}</div> : null}
      {edit.error ? <div style={warningStyle}>{edit.error}</div> : null}

      <section style={cardStyle}>
        <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>概览</h2>
        <p>{project.objective}</p>
        <p style={mutedStyle}>团队：{PRESET_TEAM.name}（预设，只读）</p>
        <p style={mutedStyle}>运行时：Mock</p>
        <p style={mutedStyle}>工作区：{publicWorkspaceLabel(grant)}</p>
        <p style={mutedStyle}>{budget}</p>
        <p style={mutedStyle}>待审批：{approvals}</p>
      </section>

      {project.status === "draft" || project.status === "planning" ? (
        <section style={cardStyle}>
          <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>名称与目标</h2>
          <label style={labelStyle} htmlFor="wf-edit-name">
            名称
          </label>
          <input
            id="wf-edit-name"
            style={inputStyle}
            value={edit.name}
            onChange={(event) =>
              setEdit((current) => ({ ...current, name: event.target.value, error: null }))
            }
          />
          <label style={labelStyle} htmlFor="wf-edit-objective">
            目标
          </label>
          <textarea
            id="wf-edit-objective"
            style={{ ...inputStyle, minHeight: "80px" }}
            value={edit.objective}
            onChange={(event) =>
              setEdit((current) => ({ ...current, objective: event.target.value, error: null }))
            }
          />
          <button
            type="button"
            style={buttonStyle("secondary", edit.submitting)}
            disabled={edit.submitting}
            onClick={() => void saveEdit()}
          >
            保存
          </button>
        </section>
      ) : null}

      {project.status === "draft" ? (
        <section style={cardStyle}>
          <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>配置</h2>
          <p style={mutedStyle}>
            绑定工作区、预设团队与 Mock 运行时后才能开始规划。界面不展示宿主绝对路径。
          </p>
          <div style={rowStyle}>
            <button
              type="button"
              style={buttonStyle("secondary")}
              data-testid="project-bind-workspace"
              onClick={() => void bindWorkspace()}
            >
              绑定工作区
            </button>
            <span style={mutedStyle}>{publicWorkspaceLabel(grant)}</span>
          </div>
          <label style={labelStyle}>预设团队</label>
          <input style={inputStyle} value={PRESET_TEAM.name} readOnly />
          <label style={labelStyle}>运行时</label>
          <input style={inputStyle} value="Mock" readOnly />
          <p style={mutedStyle}>预算展示见概览。硬货币上限在未知成本时不会被当成 0。</p>
        </section>
      ) : null}

      {project.status === "planning" ? (
        <section style={cardStyle}>
          <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>计划</h2>
          <p>计划产物版本：{project.planArtifactVersionId ?? "尚未生成"}</p>
          <p style={mutedStyle}>
            确认计划会提交 planArtifactVersionId。未确认前不会开始执行开发任务。
          </p>
        </section>
      ) : null}

      <section style={cardStyle}>
        <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>任务</h2>
        {tasks.length === 0 ? (
          <p style={mutedStyle}>
            {project.status === "draft" || project.status === "planning"
              ? "确认计划后才会发布执行任务图。"
              : "暂无任务。"}
          </p>
        ) : (
          <ul style={listStyle} data-testid="project-task-list">
            {tasks.map((task) => (
              <li
                key={task.id}
                style={listItemStyle}
                onClick={() => navigate(`/projects/${project.id}/tasks/${task.id}`)}
              >
                <strong>{task.title}</strong>
                <div style={mutedStyle}>
                  {taskStatusLabel(task.status)} · attempt {task.attempt} · generation{" "}
                  {task.generation}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
