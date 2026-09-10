import { useEffect, useReducer, useState, type FormEvent } from "react";
import type { DesktopClient, ProjectDto } from "@workforce/desktop-client";

import type { FeaturePageProps } from "../contract.js";
import { commandOptions } from "./command.js";
import { emptyCreateForm, projectStatusLabel, reduceCreateProjectForm } from "./model.js";
import {
  buttonStyle,
  cardStyle,
  errorStyle,
  inputStyle,
  labelStyle,
  listItemStyle,
  listStyle,
  mutedStyle,
  titleStyle,
  warningStyle,
} from "./ui.js";

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
    <div>
      <h1 style={titleStyle}>项目</h1>
      {loadError ? <div style={errorStyle}>{loadError}</div> : null}
      <section style={cardStyle}>
        <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>新建项目</h2>
        <form onSubmit={onCreate}>
          <label style={labelStyle} htmlFor="wf-project-name">
            名称
          </label>
          <input
            id="wf-project-name"
            name="name"
            style={inputStyle}
            value={form.name}
            onChange={(event) =>
              dispatch({ type: "change", field: "name", value: event.target.value })
            }
            required
          />
          <label style={labelStyle} htmlFor="wf-project-objective">
            目标
          </label>
          <textarea
            id="wf-project-objective"
            name="objective"
            style={{ ...inputStyle, minHeight: "80px" }}
            value={form.objective}
            onChange={(event) =>
              dispatch({ type: "change", field: "objective", value: event.target.value })
            }
            required
          />
          {form.error ? (
            <div style={form.needsRefresh ? warningStyle : errorStyle}>
              {form.error}
              {form.needsRefresh ? " 请刷新后重试。" : null}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={form.submitting}
            style={buttonStyle("primary", form.submitting)}
            data-testid="project-create"
          >
            {form.submitting ? "创建中…" : "创建项目"}
          </button>
        </form>
      </section>
      <section style={cardStyle}>
        <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>项目列表</h2>
        {projects.length === 0 ? (
          <p style={mutedStyle}>还没有项目。</p>
        ) : (
          <ul style={listStyle}>
            {projects.map((project) => (
              <li
                key={project.id}
                style={listItemStyle}
                onClick={() => navigate(`/projects/${project.id}`)}
              >
                <strong>{project.name}</strong>
                <div style={mutedStyle}>
                  {projectStatusLabel(project)} · {project.updatedAt}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
