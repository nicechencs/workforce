import { useEffect, useReducer, useState, type FormEvent } from "react";
import type { DesktopClient, ProjectDto } from "@workforce/desktop-client";

import {
  Button,
  Card,
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
import { commandOptions } from "./command.js";
import { emptyCreateForm, projectStatusLabel, reduceCreateProjectForm } from "./model.js";

export function ProjectList(props: FeaturePageProps & { client: DesktopClient }) {
  const { client, navigate } = props;
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, dispatch] = useReducer(reduceCreateProjectForm, emptyCreateForm);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const page = await client.listProjects();
        if (!cancelled) {
          setProjects(page.items);
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
          <Muted>还没有项目。</Muted>
        ) : (
          <List>
            {projects.map((project) => (
              <ListRow
                key={project.id}
                title={project.name}
                meta={`${projectStatusLabel(project)} · ${project.updatedAt}`}
                onClick={() => navigate(`/projects/${project.id}`)}
              />
            ))}
          </List>
        )}
      </Card>
    </Page>
  );
}
