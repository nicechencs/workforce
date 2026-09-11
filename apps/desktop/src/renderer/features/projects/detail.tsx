import { useCallback, useEffect, useState } from "react";
import type {
  ArtifactDto,
  CapabilitiesDto,
  DesktopClient,
  ProjectDto,
  RunDto,
  TaskDto,
} from "@workforce/desktop-client";
import type { WorkspaceGrant } from "@workforce/ui";

import type { FeaturePageProps } from "../contract.js";
import { asCatalogClient, getPreloadApi, hasCatalogMethod } from "../hooks.js";
import {
  isActiveRun,
  runStatusLabel as runHeadlineStatus,
  timelineFromEvents,
} from "../runs/model.js";
import { ProjectTeamBindingField } from "../teams/page.js";
import {
  PRESET_TEAM,
  TEAM_WRITE_API_MISSING,
  asTeamView,
  isTeamReadyForPlanning,
  mergeCatalogTeams,
  probeTeamWriteSupport,
  projectTeamVersionId,
  unavailableTeamWriteSupport,
  type TeamView,
  type TeamWriteSupport,
} from "../teams/model.js";
import { sortTasksForDag, taskStatusLabel } from "../tasks/model.js";
import { commandOptions, errorMessage, isCommandAccepted, isRevisionConflict } from "./command.js";
import {
  applyFormFailure,
  applyProjectRefresh,
  artifactKindLabel,
  budgetPlaceholder,
  defaultCapabilities,
  defaultDraftSelection,
  emptyTasksCopy,
  nodeScopeLabel,
  pendingApprovalCount,
  pinnedArtifactVersion,
  projectEditForm,
  projectPolicyCopy,
  projectProgressLabel,
  projectStatusLabel,
  publicWorkspaceLabel,
  splitProjectRuns,
  statusBadgeTone,
  taskDependencyLabel,
  taskOwnerLabel,
  visibleProjectActions,
  type ProjectActionId,
  type ProjectEditForm,
} from "./model.js";
import {
  hashWithProjectTab,
  parseTabFromHash,
  PROJECT_DETAIL_TAB_LABELS,
  PROJECT_DETAIL_TABS,
  projectDetailPath,
  type ProjectDetailTab,
} from "./tabs.js";
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
  tabButtonStyle,
  tabListStyle,
  titleStyle,
  warningStyle,
} from "./ui.js";

export function ProjectDetail(props: FeaturePageProps & { client: DesktopClient }) {
  const { client, params, navigate } = props;
  const projectId = params.projectId ?? "";
  const [project, setProject] = useState<ProjectDto | null>(null);
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [runs, setRuns] = useState<RunDto[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactDto[]>([]);
  const [events, setEvents] = useState<unknown[]>([]);
  const [approvals, setApprovals] = useState(0);
  const [capabilities, setCapabilities] = useState<CapabilitiesDto>(defaultCapabilities());
  const [grant, setGrant] = useState<WorkspaceGrant | null>(null);
  const [budget, setBudget] = useState<string>(budgetPlaceholder(null));
  const [edit, setEdit] = useState<ProjectEditForm>(projectEditForm({ name: "", objective: "" }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ProjectActionId | null>(null);
  const [tab, setTab] = useState<ProjectDetailTab>(() =>
    typeof window === "undefined" ? "overview" : parseTabFromHash(window.location.hash),
  );
  const [selection, setSelection] = useState(defaultDraftSelection);
  const [catalogTeams, setCatalogTeams] = useState<TeamView[]>([PRESET_TEAM]);
  const [teamWrite, setTeamWrite] = useState<TeamWriteSupport>(unavailableTeamWriteSupport);
  const [bindBusy, setBindBusy] = useState(false);
  const [bindError, setBindError] = useState<string | null>(null);

  const reload = useCallback(
    async (keepInput: boolean) => {
      const loaded = await client.getProject(projectId);
      setProject(loaded);
      setEdit((current) =>
        keepInput ? applyProjectRefresh(current, loaded, true) : projectEditForm(loaded),
      );
      const [taskPage, approvalPage, caps, runPage, artifactPage, eventPage] = await Promise.all([
        client.listTasks({ projectId }),
        client.listApprovals({ projectId }),
        client.getCapabilities().catch(() => defaultCapabilities()),
        client.listRuns({ projectId, limit: 50 }).catch(() => emptyList<RunDto>()),
        client.listArtifacts({ projectId, limit: 50 }).catch(() => emptyList<ArtifactDto>()),
        client.listEvents({ projectId, limit: 50 }).catch(() => emptyList<unknown>()),
      ]);
      setTasks(sortTasksForDag(taskPage.items));
      setApprovals(pendingApprovalCount(approvalPage.items));
      setCapabilities(caps);
      setRuns(runPage.items);
      setArtifacts(artifactPage.items);
      setEvents(eventPage.items);
      const catalog = asCatalogClient(client);
      const support = await probeTeamWriteSupport(client);
      setTeamWrite(support);
      if (hasCatalogMethod(catalog, "listTeams")) {
        try {
          const teamPage = await catalog.listTeams();
          const parsed = teamPage.items
            .map(asTeamView)
            .filter((item): item is TeamView => item !== null);
          if (parsed.length > 0) {
            setCatalogTeams(mergeCatalogTeams(parsed));
          }
        } catch {
          setCatalogTeams([PRESET_TEAM]);
        }
      }
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onHashChange = (): void => {
      setTab(parseTabFromHash(window.location.hash));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  function selectTab(next: ProjectDetailTab) {
    setTab(next);
    if (typeof window === "undefined") {
      return;
    }
    const nextHash = hashWithProjectTab(projectDetailPath(projectId), next);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }

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

  async function bindPublishedTeam() {
    if (!project) {
      return;
    }
    if (!teamWrite.bind) {
      setBindError(TEAM_WRITE_API_MISSING);
      return;
    }
    const selected = catalogTeams.find((team) => team.id === selection.teamId);
    if (!selected || selected.status !== "published" || selected.kind === "preset") {
      return;
    }
    setBindBusy(true);
    setBindError(null);
    try {
      const next = await client.patchProject(
        project.id,
        { teamVersionId: selected.versionId },
        commandOptions(project.stateRevision),
      );
      const echoed = projectTeamVersionId(next);
      if (echoed !== selected.versionId) {
        setProject(next);
        setBindError("服务端未回传精确 teamVersionId，未当作自定义团队绑定成功。");
        return;
      }
      setProject(next);
    } catch (caught) {
      setBindError(errorMessage(caught));
    } finally {
      setBindBusy(false);
    }
  }

  if (error && !project) {
    return <div style={errorStyle}>{error}</div>;
  }
  if (!project) {
    return <p style={mutedStyle}>加载项目…</p>;
  }

  const workspaceBound = grant !== null;
  const selectedTeam = catalogTeams.find((team) => team.id === selection.teamId) ?? PRESET_TEAM;
  const boundTeamVersionId = projectTeamVersionId(project);
  const actionInput = {
    status: project.status,
    cancelRequested: project.cancelRequested,
    workspaceBound,
    teamSelected: isTeamReadyForPlanning({
      selection: {
        teamId: selection.teamId,
        versionId: selection.teamVersionId,
        status: selectedTeam.status,
        kind: selectedTeam.kind,
      },
      projectTeamVersionId: boundTeamVersionId,
    }),
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
      <p style={mutedStyle} data-testid="project-chrome-summary">
        {project.objective} · 团队 {selectedTeam.name} · 工作区 {publicWorkspaceLabel(grant)} ·{" "}
        {budget}
      </p>

      <nav style={tabListStyle} data-testid="project-detail-tabs" aria-label="项目详情">
        {PROJECT_DETAIL_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            data-testid={`project-tab-${id}`}
            style={tabButtonStyle(tab === id)}
            onClick={() => selectTab(id)}
          >
            {PROJECT_DETAIL_TAB_LABELS[id]}
          </button>
        ))}
      </nav>

      <div data-testid={`project-tab-panel-${tab}`} role="tabpanel">
        {tab === "overview" ? (
          <OverviewPanel
            project={project}
            tasks={tasks}
            approvals={approvals}
            grant={grant}
            budget={budget}
            teamName={selectedTeam.name}
            edit={edit}
            setEdit={setEdit}
            onSave={() => void saveEdit()}
            onOpenSettings={() => selectTab("settings")}
          />
        ) : null}
        {tab === "tasks" ? (
          <TasksPanel
            project={project}
            tasks={tasks}
            onOpen={(taskId) => navigate(`/projects/${project.id}/tasks/${taskId}`)}
          />
        ) : null}
        {tab === "runs" ? (
          <RunsPanel runs={runs} onOpen={(runId) => navigate(`/runs/${runId}`)} />
        ) : null}
        {tab === "artifacts" ? (
          <ArtifactsPanel
            artifacts={artifacts}
            onOpen={(artifactId, versionId) =>
              navigate(`/artifacts/${artifactId}/versions/${versionId}`)
            }
          />
        ) : null}
        {tab === "activity" ? <ActivityPanel events={events} /> : null}
        {tab === "settings" ? (
          <SettingsPanel
            project={project}
            grant={grant}
            budget={budget}
            capabilities={capabilities}
            teams={catalogTeams}
            teamWrite={teamWrite}
            selection={selection}
            projectTeamVersionId={boundTeamVersionId}
            bindBusy={bindBusy}
            bindError={bindError}
            onBind={() => void bindWorkspace()}
            onSelectTeam={(team) => {
              setSelection((current) => ({
                ...current,
                teamId: team.id,
                teamVersionId: team.versionId,
              }));
              setBindError(null);
            }}
            onBindTeam={() => void bindPublishedTeam()}
          />
        ) : null}
      </div>
    </div>
  );
}

function emptyList<T>(): { items: T[] } {
  return { items: [] };
}

function OverviewPanel(props: {
  project: ProjectDto;
  tasks: TaskDto[];
  approvals: number;
  grant: WorkspaceGrant | null;
  budget: string;
  teamName: string;
  edit: ProjectEditForm;
  setEdit: (update: (current: ProjectEditForm) => ProjectEditForm) => void;
  onSave: () => void;
  onOpenSettings: () => void;
}) {
  const { project, tasks, approvals, grant, budget, teamName, edit } = props;
  return (
    <>
      <section style={cardStyle} data-testid="project-overview">
        <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>概览</h2>
        <p>{project.objective}</p>
        <p style={mutedStyle}>状态：{projectStatusLabel(project)}</p>
        <p style={mutedStyle}>团队：{teamName}</p>
        <p style={mutedStyle}>节点范围：{nodeScopeLabel()}</p>
        <p style={mutedStyle} data-testid="project-progress">
          {projectProgressLabel(tasks)}
        </p>
        <p style={mutedStyle}>运行时：Mock</p>
        <p style={mutedStyle}>工作区：{publicWorkspaceLabel(grant)}（只读摘要；写入在 Settings）</p>
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
              props.setEdit((current) => ({ ...current, name: event.target.value, error: null }))
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
              props.setEdit((current) => ({
                ...current,
                objective: event.target.value,
                error: null,
              }))
            }
          />
          <button
            type="button"
            style={buttonStyle("secondary", edit.submitting)}
            disabled={edit.submitting}
            onClick={props.onSave}
          >
            保存
          </button>
        </section>
      ) : null}

      {project.status === "draft" ? (
        <section style={cardStyle}>
          <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>下一步</h2>
          <p style={mutedStyle}>WorkspaceBinding 写入在 Settings。页头在绑定完成后才能开始规划。</p>
          <button
            type="button"
            style={buttonStyle("secondary")}
            data-testid="project-open-settings"
            onClick={props.onOpenSettings}
          >
            去 Settings 绑定工作区
          </button>
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
    </>
  );
}

function TasksPanel(props: {
  project: ProjectDto;
  tasks: TaskDto[];
  onOpen: (taskId: string) => void;
}) {
  return (
    <section style={cardStyle}>
      <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>Tasks</h2>
      <p style={mutedStyle}>按已发布执行图依赖排列的任务列表。</p>
      {props.tasks.length === 0 ? (
        <p style={mutedStyle}>{emptyTasksCopy(props.project.status)}</p>
      ) : (
        <ul style={listStyle} data-testid="project-task-list">
          {props.tasks.map((task) => (
            <li key={task.id} style={listItemStyle} onClick={() => props.onOpen(task.id)}>
              <strong>{task.title}</strong>
              <div style={mutedStyle} data-testid={`project-task-deps-${task.id}`}>
                {taskStatusLabel(task.status)} · 负责人 {taskOwnerLabel(task)} ·{" "}
                {taskDependencyLabel(task, props.tasks)} · attempt {task.attempt} · generation{" "}
                {task.generation}
                {task.workflowNodeId ? ` · node ${task.workflowNodeId}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RunsPanel(props: { runs: RunDto[]; onOpen: (runId: string) => void }) {
  const { current, history } = splitProjectRuns(props.runs);
  return (
    <>
      <section style={cardStyle} data-testid="project-runs-current">
        <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>当前执行</h2>
        <RunList runs={current} empty="没有正在执行的 Run。" onOpen={props.onOpen} />
      </section>
      <section style={cardStyle} data-testid="project-runs-history">
        <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>历史执行</h2>
        <RunList runs={history} empty="暂无历史 Run。" onOpen={props.onOpen} />
      </section>
    </>
  );
}

function RunList(props: { runs: RunDto[]; empty: string; onOpen: (runId: string) => void }) {
  if (props.runs.length === 0) {
    return <p style={mutedStyle}>{props.empty}</p>;
  }
  return (
    <ul style={listStyle}>
      {props.runs.map((run) => (
        <li key={run.id} style={listItemStyle} onClick={() => props.onOpen(run.id)}>
          <strong>{run.id}</strong>
          <div style={mutedStyle}>
            {runHeadlineStatus(run)}
            {isActiveRun(run) ? " · 当前" : " · 历史"} · Task {run.taskId} · attempt {run.attempt}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ArtifactsPanel(props: {
  artifacts: ArtifactDto[];
  onOpen: (artifactId: string, versionId: string) => void;
}) {
  return (
    <section style={cardStyle} data-testid="project-artifacts">
      <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>Artifacts</h2>
      <p style={mutedStyle}>
        代码、文档、报告与外部资源。打开时固定到 ArtifactVersion，不用 latest。
      </p>
      {props.artifacts.length === 0 ? (
        <p style={mutedStyle}>暂无产物。</p>
      ) : (
        <ul style={listStyle}>
          {props.artifacts.map((artifact) => {
            const pinned = pinnedArtifactVersion(artifact);
            return (
              <li
                key={artifact.id}
                style={listItemStyle}
                onClick={() => {
                  if (pinned) {
                    props.onOpen(artifact.id, pinned.id);
                  }
                }}
              >
                <strong>{artifact.logicalName}</strong>
                <div style={mutedStyle}>
                  {artifactKindLabel(artifact.kind)}
                  {pinned
                    ? ` · ${pinned.id} · hash ${pinned.hash}`
                    : " · 尚无已固定版本，无法打开内容"}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ActivityPanel(props: { events: unknown[] }) {
  const rows = timelineFromEvents(props.events);
  return (
    <section style={cardStyle} data-testid="project-activity">
      <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>Activity</h2>
      <p style={mutedStyle}>项目 Event 时间线。空列表表示尚未返回事件，不是伪造动态。</p>
      {rows.length === 0 ? (
        <p style={mutedStyle}>暂无项目事件。</p>
      ) : (
        <ol style={{ ...listStyle, paddingLeft: 0 }}>
          {rows.map((row) => (
            <li
              key={row.key}
              data-testid="project-activity-row"
              style={{
                borderBottom: "1px solid var(--wf-color-border, #d1d5db)",
                padding: "var(--wf-space-sm, 8px) 0",
              }}
            >
              <div style={mutedStyle}>{row.time}</div>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  fontFamily: "ui-monospace, monospace",
                  fontSize: "var(--wf-font-label, 14px)",
                }}
              >
                {row.summary}
              </pre>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function SettingsPanel(props: {
  project: ProjectDto;
  grant: WorkspaceGrant | null;
  budget: string;
  capabilities: CapabilitiesDto;
  teams: TeamView[];
  teamWrite: TeamWriteSupport;
  selection: { teamId: string; teamVersionId: string };
  projectTeamVersionId: string | null;
  bindBusy: boolean;
  bindError: string | null;
  onBind: () => void;
  onSelectTeam: (team: TeamView) => void;
  onBindTeam: () => void;
}) {
  const showBind = props.project.status === "draft";
  return (
    <>
      <section style={cardStyle} data-testid="project-settings-workspace">
        <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>WorkspaceBinding</h2>
        <p style={mutedStyle}>绑定工作区、已发布团队与 Mock 运行时。界面不展示宿主绝对路径。</p>
        <div style={rowStyle}>
          {showBind ? (
            <button
              type="button"
              style={buttonStyle("secondary")}
              data-testid="project-bind-workspace"
              onClick={props.onBind}
            >
              绑定工作区
            </button>
          ) : null}
          <span style={mutedStyle}>{publicWorkspaceLabel(props.grant)}</span>
        </div>
        <ProjectTeamBindingField
          teams={props.teams}
          writeSupport={props.teamWrite}
          selection={{ teamId: props.selection.teamId, versionId: props.selection.teamVersionId }}
          projectTeamVersionId={props.projectTeamVersionId}
          disabled={!showBind}
          busy={props.bindBusy}
          error={props.bindError}
          onSelect={props.onSelectTeam}
          onBind={props.onBindTeam}
        />
        <label style={labelStyle}>运行时</label>
        <input style={inputStyle} value="Mock" readOnly />
      </section>
      <section style={cardStyle} data-testid="project-settings-budget">
        <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>预算</h2>
        <p style={mutedStyle}>{props.budget}</p>
        <p style={mutedStyle}>硬货币上限在未知成本时不会被当成 0。</p>
      </section>
      <section style={cardStyle} data-testid="project-settings-policy">
        <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>策略</h2>
        <p style={mutedStyle}>{projectPolicyCopy(props.capabilities.project)}</p>
      </section>
    </>
  );
}
