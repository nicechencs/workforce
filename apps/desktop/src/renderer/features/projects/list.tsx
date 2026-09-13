import { useEffect, useReducer, useState, type FormEvent } from "react";
import type { ApprovalDto, DesktopClient, ProjectDto, RunDto } from "@workforce/desktop-client";

import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  Input,
  List,
  ListRow,
  Muted,
  Page,
  Textarea,
} from "../../components/ui.js";
import type { FeaturePageProps } from "../contract.js";
import { isActiveRun } from "../runs/model.js";
import { commandOptions } from "./command.js";
import { emptyCreateForm, pendingApprovalCount, projectStatusLabel, reduceCreateProjectForm } from "./model.js";

export function ProjectList(props: FeaturePageProps & { client: DesktopClient }) {
  const { client, navigate } = props;
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [approvals, setApprovals] = useState<ApprovalDto[]>([]);
  const [runs, setRuns] = useState<RunDto[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, dispatch] = useReducer(reduceCreateProjectForm, emptyCreateForm);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [projectPage, approvalPage, runPage] = await Promise.all([
          client.listProjects(),
          client.listApprovals({ limit: 50 }).catch(() => ({ items: [] as ApprovalDto[] })),
          client.listRuns({ limit: 50 }).catch(() => ({ items: [] as RunDto[] })),
        ]);
        if (!cancelled) {
          setProjects(projectPage.items);
          setApprovals(approvalPage.items);
          setRuns(runPage.items);
          setLoadError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : "无法加载项目");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? form.name).trim();
    const objective = String(data.get("objective") ?? form.objective).trim();
    dispatch({ type: "change", field: "name", value: name });
    dispatch({ type: "change", field: "objective", value: objective });
    dispatch({ type: "submit" });
    try {
      const created = await client.createProject({ name, objective }, commandOptions());
      dispatch({ type: "success" });
      navigate(`/projects/${created.id}`);
    } catch (error) {
      dispatch({ type: "failure", error });
    }
  }

  return (
    <Page title="项目" subtitle="围绕一个 Project 编排 Team、Tasks 与 Workflow。">
      <ErrorText>{loadError}</ErrorText>
      <Card title="新建项目">
        <form onSubmit={onCreate}>
          <Field label="名称" htmlFor="wf-project-name">
            <Input
              id="wf-project-name"
              name="name"
              value={form.name}
              onChange={(event) =>
                dispatch({ type: "change", field: "name", value: event.target.value })
              }
              required
            />
          </Field>
          <Field label="目标" htmlFor="wf-project-objective">
            <Textarea
              id="wf-project-objective"
              name="objective"
              rows={4}
              value={form.objective}
              onChange={(event) =>
                dispatch({ type: "change", field: "objective", value: event.target.value })
              }
              required
            />
          </Field>
          {form.error ? (
            <>
              <ErrorText>{form.error}</ErrorText>
              {form.needsRefresh ? <Muted>请刷新后重试。</Muted> : null}
            </>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            disabled={form.submitting}
            testId="project-create"
          >
            {form.submitting ? "创建中…" : "创建项目"}
          </Button>
        </form>
      </Card>
      <Card title="项目列表">
        {projects.length === 0 ? (
          <EmptyState title="还没有项目" action={<Muted>用上方表单创建第一个项目。</Muted>}>
            项目是干活主对象，不是会话历史。
          </EmptyState>
        ) : (
          <List>
            {projects.map((project) => {
              const pending = pendingApprovalCount(
                approvals.filter((item) => item.projectId === project.id),
              );
              const running = runs.filter(
                (run) => run.projectId === project.id && isActiveRun(run),
              ).length;
              const team = project.teamVersionId
                ? `TeamVersion ${project.teamVersionId}`
                : "未绑定 Team";
              return (
                <ListRow
                  key={project.id}
                  title={project.name}
                  meta={`${projectStatusLabel(project)} · ${team} · 进行中 Run ${running} · 待审批 ${pending}`}
                  onClick={() => navigate(`/projects/${project.id}`)}
                />
              );
            })}
          </List>
        )}
      </Card>
    </Page>
  );
}
