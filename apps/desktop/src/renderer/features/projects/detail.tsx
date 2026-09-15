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

import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  Input,
  List,
  ListRow,
  Muted,
  Notice,
  Page,
  Tabs,
  Textarea,
  type Tone,
} from "../../components/ui.js";
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
  PRESET_RUNTIME_ID,
  TEAM_WRITE_API_MISSING,
  isTeamReadyForPlanning,
  loadTeamCatalog,
  mergeCatalogTeams,
  probeTeamWriteSupport,
  projectTeamVersionId,
  unavailableTeamWriteSupport,
  type TeamView,
  type TeamWriteSupport,
} from "../teams/model.js";
import {
  probeHostRuntime,
  projectRuntimeLabel,
  type HostRuntimeView,
  unprobedHostRuntime,
} from "../runtime/model.js";
import {
  OrchestrationModeControl,
  buildStartProjectInput,
  DEFAULT_MODE,
  probeOrchestrationSupport,
  resolveSelectedMode,
  runOrchestrationModeLabel,
  type OrchestrationMode,
} from "../orchestration/index.js";
import { sortTasksForDag, taskStatusLabel, evaluationRowForKind, evaluationRowFromArtifacts } from "../tasks/model.js";
import { identityPreviewLine, roleLibraryDetailHref } from "../role-library/model.js";
import { FEATURE_DELIVERY_STEPS, stepKindLabel } from "../workflows/model.js";
import { commandOptions, errorMessage, isCommandAccepted, isRevisionConflict } from "./command.js";
import {
  PROJECT_DIRECT_ADHOC_NOTE,
  PROJECT_DIRECT_EMPTY_OPTION,
  startProjectDirectExecution,
} from "./direct.js";
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
  PLANNING_TEMPLATE_NOTE,
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
  const [orchestrationMode, setOrchestrationMode] = useState<OrchestrationMode>(DEFAULT_MODE);
  const [directTaskId, setDirectTaskId] = useState("");
  const [hostRuntime, setHostRuntime] = useState<HostRuntimeView>(unprobedHostRuntime);

  const reload = useCallback(
    async (keepInput: boolean) => {
      const loaded = await client.getProject(projectId);
      setProject(loaded);
      setEdit((current) =>
        keepInput ? applyProjectRefresh(current, loaded, true) : projectEditForm(loaded),
      );
      const [taskPage, approvalPage, caps, runPage, artifactPage, eventPage, runtimeView] =
        await Promise.all([
          client.listTasks({ projectId }),
          client.listApprovals({ projectId }),
          client.getCapabilities().catch(() => defaultCapabilities()),
          client.listRuns({ projectId, limit: 50 }).catch(() => emptyList<RunDto>()),
          client.listArtifacts({ projectId, limit: 50 }).catch(() => emptyList<ArtifactDto>()),
          client.listEvents({ projectId, limit: 50 }).catch(() => emptyList<unknown>()),
          probeHostRuntime(client),
        ]);
      setTasks(sortTasksForDag(taskPage.items));
      setApprovals(pendingApprovalCount(approvalPage.items));
      setCapabilities(caps);
      setRuns(runPage.items);
      setArtifacts(artifactPage.items);
      setEvents(eventPage.items);
      setHostRuntime(runtimeView);
      const catalog = asCatalogClient(client);
      const support = await probeTeamWriteSupport(client);
      setTeamWrite(support);
      if (hasCatalogMethod(catalog, "listTeams")) {
        try {
          const parsed = await loadTeamCatalog(client);
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
        const probe = probeOrchestrationSupport({ capabilities });
        const mode = resolveSelectedMode(orchestrationMode, probe);
        if (mode === "direct") {
          if (!probe.direct) {
            setError(probe.reason);
            return;
          }
          const landed = await startProjectDirectExecution({
            client,
            projectId: project.id,
            title: project.name,
            selectedTaskId: directTaskId,
            tasks,
            probe,
          });
          setDirectTaskId(landed.taskId);
          await reload(true);
          return;
        }
        const start = buildStartProjectInput(mode, probe);
        if (!start.ok) {
          setError(start.error);
          return;
        }
        const next = await client.startProject(project.id, opts, start.input);
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
    return (
      <Page title="项目">
        <ErrorText>{error}</ErrorText>
      </Page>
    );
  }
  if (!project) {
    return (
      <Page title="项目">
        <Muted>加载项目…</Muted>
      </Page>
    );
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
    runtimeSelected:
      selection.runtimeId === PRESET_RUNTIME_ID ||
      selection.runtimeId === "codex" ||
      selection.runtimeId === "mock",
    capabilities: capabilities.project,
    ...(project.planArtifactVersionId !== undefined
      ? { planArtifactVersionId: project.planArtifactVersionId }
      : {}),
  };
  const actions = visibleProjectActions(actionInput);
  const statusLabel = projectStatusLabel(project);
  const probe = probeOrchestrationSupport({ capabilities });
  const selectedMode = resolveSelectedMode(orchestrationMode, probe);

  return (
    <Page
      title={project.name}
      actions={
        <Button
          variant="outline"
          onClick={() => {
            navigate("/projects");
          }}
        >
          返回项目
        </Button>
      }
    >
      <div className="wf-chrome-row">
        <Badge
          tone={toneFromStatus(statusBadgeTone(project.status, project.cancelRequested))}
          testId="project-status"
        >
          {statusLabel}
        </Badge>
        {actions.map((action) => (
          <Button
            key={action.id}
            variant={action.kind === "primary" ? "primary" : "secondary"}
            disabled={!action.enabled || busy !== null}
            testId={`project-action-${action.id}`}
            onClick={() => void runAction(action.id)}
          >
            {action.label}
          </Button>
        ))}
        {edit.needsRefresh ? <Button onClick={() => void reload(true)}>刷新</Button> : null}
      </div>
      <ErrorText>{error}</ErrorText>
      <ErrorText>{edit.error}</ErrorText>
      <p className="wf-muted" data-testid="project-chrome-summary">
        {project.objective} · 团队 {selectedTeam.name} · 工作区 {publicWorkspaceLabel(grant)} ·{" "}
        {budget}
      </p>
      <OrchestrationModeControl
        selected={selectedMode}
        probe={probe}
        disabled={busy !== null}
        onChange={setOrchestrationMode}
        tasks={tasks.map((task) => ({ id: task.id, title: task.title }))}
        selectedTaskId={directTaskId}
        onSelectTask={setDirectTaskId}
        emptyOptionLabel={PROJECT_DIRECT_EMPTY_OPTION}
        emptyTaskCopy={PROJECT_DIRECT_ADHOC_NOTE}
      />

      <Tabs
        ariaLabel="项目详情"
        testId="project-detail-tabs"
        tabTestIdPrefix="project-tab-"
        items={PROJECT_DETAIL_TABS.map((id) => ({ id, label: PROJECT_DETAIL_TAB_LABELS[id] }))}
        value={tab}
        onChange={selectTab}
      />

      <div data-testid={`project-tab-panel-${tab}`} role="tabpanel">
        {tab === "overview" ? (
          <OverviewPanel
            project={project}
            tasks={tasks}
            approvals={approvals}
            grant={grant}
            budget={budget}
            teamName={selectedTeam.name}
            teamMembers={selectedTeam.members}
            onOpenTeam={() => navigate(`/teams/${selectedTeam.id}`)}
            onOpenRole={(workerId, versionId) =>
              navigate(roleLibraryDetailHref(workerId, versionId ? { versionId } : {}))
            }
            runtimeLabel={projectRuntimeLabel(hostRuntime)}
            runtimeSummary={hostRuntime.summary}
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
            artifacts={artifacts}
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
            runtime={hostRuntime}
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
    </Page>
  );
}

function emptyList<T>(): { items: T[] } {
  return { items: [] };
}

function toneFromStatus(tone: "health" | "warning" | "danger" | "muted"): Tone {
  return tone === "health" ? "success" : tone;
}

function OverviewPanel(props: {
  project: ProjectDto;
  tasks: TaskDto[];
  approvals: number;
  grant: WorkspaceGrant | null;
  budget: string;
  teamName: string;
  teamMembers: TeamView["members"];
  runtimeLabel: string;
  runtimeSummary: string;
  edit: ProjectEditForm;
  setEdit: (update: (current: ProjectEditForm) => ProjectEditForm) => void;
  onSave: () => void;
  onOpenSettings: () => void;
  onOpenTeam: () => void;
  onOpenRole: (workerId: string, versionId?: string) => void;
}) {
  const { project, tasks, approvals, grant, budget, teamName, edit } = props;
  return (
    <>
      <Card title="概览" testId="project-overview">
        <p>{project.objective}</p>
        <dl className="wf-detail-grid">
          <dt>状态</dt>
          <dd>{projectStatusLabel(project)}</dd>
          <dt>团队</dt>
          <dd>
            <Button variant="ghost" onClick={props.onOpenTeam}>
              {teamName}
            </Button>
          </dd>
          <dt>节点范围</dt>
          <dd>{nodeScopeLabel()}</dd>
          <dt>进度</dt>
          <dd data-testid="project-progress">{projectProgressLabel(tasks)}</dd>
          <dt>运行时</dt>
          <dd>{props.runtimeLabel}</dd>
          <dt>工作区</dt>
          <dd>{publicWorkspaceLabel(grant)}（只读摘要；写入在 Settings）</dd>
          <dt>预算</dt>
          <dd>{budget}</dd>
          <dt>待审批</dt>
          <dd>{approvals}</dd>
        </dl>
        <Muted>{props.runtimeSummary}</Muted>
      </Card>
      <Card title="阵容里的角色" testId="project-overview-roles">
        <Muted>点行打开角色库同一详情。改卡片去库，不在项目里复制一套 Agent。</Muted>
        {props.teamMembers.length === 0 ? (
          <Muted>还没有成员。去 AI 团队选用已发布 WorkerVersion。</Muted>
        ) : (
          <List testId="project-overview-role-list">
            {props.teamMembers.map((member) => {
              const workerId = member.workerId;
              return (
                <ListRow
                  key={member.id}
                  testId={`project-overview-role-${member.id}`}
                  title={`${member.title} · ${member.role}`}
                  meta={
                    member.who || member.how || member.skills
                      ? identityPreviewLine(member)
                      : member.workerVersionId ?? "未引用 WorkerVersion"
                  }
                  onClick={
                    workerId
                      ? () => props.onOpenRole(workerId, member.workerVersionId)
                      : props.onOpenTeam
                  }
                />
              );
            })}
          </List>
        )}
      </Card>
      <Card title="绑定的 WorkflowVersion" testId="project-overview-workflow">
        <Notice tone="warning" title="规划仍是模板">
          {PLANNING_TEMPLATE_NOTE}
        </Notice>
        <Muted>
          {project.planArtifactVersionId
            ? `已确认计划产物 ${project.planArtifactVersionId}`
            : "未确认计划。确认前不会开始执行开发任务。"}
        </Muted>
        <Muted>
          {project.executionSnapshotId
            ? `执行快照 ${project.executionSnapshotId}。快照图来自 confirmPlan，不是画布上未发布的草稿。`
            : "尚未绑定执行图。自定义已发布图是否进入 :start 是执行缺口，不是再加标签。"}
        </Muted>
      </Card>

      {project.status === "draft" || project.status === "planning" ? (
        <Card title="名称与目标">
          <Field label="名称" htmlFor="wf-edit-name">
            <Input
              id="wf-edit-name"
              value={edit.name}
              onChange={(event) =>
                props.setEdit((current) => ({ ...current, name: event.target.value, error: null }))
              }
            />
          </Field>
          <Field label="目标" htmlFor="wf-edit-objective">
            <Textarea
              id="wf-edit-objective"
              rows={4}
              value={edit.objective}
              onChange={(event) =>
                props.setEdit((current) => ({
                  ...current,
                  objective: event.target.value,
                  error: null,
                }))
              }
            />
          </Field>
          <Button disabled={edit.submitting} onClick={props.onSave}>
            保存
          </Button>
        </Card>
      ) : null}

      {project.status === "draft" ? (
        <Card title="下一步">
          <Muted>WorkspaceBinding 写入在 Settings。页头在绑定完成后才能开始规划。</Muted>
          <Button testId="project-open-settings" onClick={props.onOpenSettings}>
            去 Settings 绑定工作区
          </Button>
        </Card>
      ) : null}

      {project.status === "planning" ? (
        <Card title="计划">
          <p>计划产物版本：{project.planArtifactVersionId ?? "尚未生成"}</p>
          <Muted>确认计划会提交 planArtifactVersionId。未确认前不会开始执行开发任务。</Muted>
          <Muted>{PLANNING_TEMPLATE_NOTE}</Muted>
          <ol className="wf-timeline" data-testid="project-planning-template-steps">
            {FEATURE_DELIVERY_STEPS.map((step, index) => (
              <li key={step.id} className="wf-timeline-row">
                <span className="wf-list-row-title">
                  {index + 1}. {step.title}
                </span>
                <span className="wf-list-row-meta">
                  {stepKindLabel(step.kind)}
                  {step.worker ? ` · ${step.worker}` : ""}
                  {step.gate ? ` · gate ${step.gate}` : ""}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </>
  );
}

function TasksPanel(props: {
  project: ProjectDto;
  tasks: TaskDto[];
  artifacts: ArtifactDto[];
  onOpen: (taskId: string) => void;
}) {
  const evaluationNote = evaluationRowFromArtifacts(props.artifacts);
  return (
    <Card title="Tasks">
      <Muted>按确认计划后的执行图依赖排列。当前仍是软件交付模板，不是画布自定义图。</Muted>
      {props.tasks.length === 0 ? (
        <EmptyState title="还没有任务">{emptyTasksCopy(props.project.status)}</EmptyState>
      ) : (
        <List testId="project-task-list">
          {props.tasks.map((task) => (
            <ListRow
              key={task.id}
              title={task.title}
              meta={
                <span data-testid={`project-task-deps-${task.id}`}>
                  {taskStatusLabel(task.status)} · 负责人 {taskOwnerLabel(task)} ·{" "}
                  {taskDependencyLabel(task, props.tasks)} · attempt {task.attempt} · generation{" "}
                  {task.generation}
                  {task.workflowNodeId ? ` · node ${task.workflowNodeId}` : ""} · {evaluationNote}
                </span>
              }
              onClick={() => props.onOpen(task.id)}
            />
          ))}
        </List>
      )}
    </Card>
  );
}

function RunsPanel(props: { runs: RunDto[]; onOpen: (runId: string) => void }) {
  const { current, history } = splitProjectRuns(props.runs);
  return (
    <>
      <Card title="当前执行" testId="project-runs-current">
        <RunList runs={current} empty="没有正在执行的 Run。" onOpen={props.onOpen} />
      </Card>
      <Card title="历史执行" testId="project-runs-history">
        <RunList runs={history} empty="暂无历史 Run。" onOpen={props.onOpen} />
      </Card>
    </>
  );
}

function RunList(props: { runs: RunDto[]; empty: string; onOpen: (runId: string) => void }) {
  if (props.runs.length === 0) {
    return <Muted>{props.empty}</Muted>;
  }
  return (
    <List>
      {props.runs.map((run) => (
        <ListRow
          key={run.id}
          title={run.id}
          meta={
            <span data-testid={`project-run-mode-${run.id}`}>
              {runHeadlineStatus(run)}
              {isActiveRun(run) ? " · 当前" : " · 历史"} · Task {run.taskId} · attempt {run.attempt}{" "}
              · 模式 {runOrchestrationModeLabel(run)}
            </span>
          }
          onClick={() => props.onOpen(run.id)}
        />
      ))}
    </List>
  );
}

function ArtifactsPanel(props: {
  artifacts: ArtifactDto[];
  onOpen: (artifactId: string, versionId: string) => void;
}) {
  return (
    <Card title="Artifacts" testId="project-artifacts">
      <Muted>代码、文档、报告与外部资源。打开时固定到 ArtifactVersion，不用 latest。</Muted>
      {props.artifacts.length === 0 ? (
        <Muted>暂无产物。</Muted>
      ) : (
        <List>
          {props.artifacts.map((artifact) => {
            const pinned = pinnedArtifactVersion(artifact);
            return (
              <ListRow
                key={artifact.id}
                title={artifact.logicalName}
                meta={`${artifactKindLabel(artifact.kind)}${
                  pinned
                    ? ` · ${pinned.id} · hash ${pinned.hash}`
                    : " · 尚无已固定版本，无法打开内容"
                } · ${evaluationRowForKind(artifact.kind)}`}
                {...(pinned ? { onClick: () => props.onOpen(artifact.id, pinned.id) } : {})}
              />
            );
          })}
        </List>
      )}
    </Card>
  );
}

function ActivityPanel(props: { events: unknown[] }) {
  const rows = timelineFromEvents(props.events);
  return (
    <Card title="Activity" testId="project-activity">
      <Muted>项目 Event 时间线。空列表表示尚未返回事件，不是伪造动态。</Muted>
      {rows.length === 0 ? (
        <Muted>暂无项目事件。</Muted>
      ) : (
        <ol className="wf-timeline">
          {rows.map((row) => (
            <li key={row.key} data-testid="project-activity-row" className="wf-timeline-row">
              <Muted>{row.time}</Muted>
              <pre className="wf-mono">{row.summary}</pre>
            </li>
          ))}
        </ol>
      )}
    </Card>
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
  runtime: HostRuntimeView;
  onBind: () => void;
  onSelectTeam: (team: TeamView) => void;
  onBindTeam: () => void;
}) {
  const showBind = props.project.status === "draft";
  return (
    <>
      <Card title="WorkspaceBinding" testId="project-settings-workspace">
        <Muted>绑定工作区、已发布团队与本机 Codex Runtime。未检测到 CLI 或未登录时启动会失败，不会回退 Mock。</Muted>
        <div className="wf-cluster">
          {showBind ? (
            <Button testId="project-bind-workspace" onClick={props.onBind}>
              绑定工作区
            </Button>
          ) : null}
          <Muted>{publicWorkspaceLabel(props.grant)}</Muted>
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
        <Field label="运行时" htmlFor="wf-project-runtime">
          <Input
            id="wf-project-runtime"
            value={projectRuntimeLabel(props.runtime)}
            readOnly
          />
        </Field>
        <Muted>{props.runtime.summary}</Muted>
      </Card>
      <Card title="预算" testId="project-settings-budget">
        <Muted>{props.budget}</Muted>
        <Muted>硬货币上限在未知成本时不会被当成 0。</Muted>
      </Card>
      <Card title="策略" testId="project-settings-policy">
        <Muted>{projectPolicyCopy(props.capabilities.project)}</Muted>
      </Card>
    </>
  );
}
