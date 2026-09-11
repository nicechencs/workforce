import { useEffect, useState } from "react";
import type { WorkflowDto } from "@workforce/desktop-client";

import type { FeaturePageProps } from "../contract.js";
import { useWorkforceClient } from "../hooks.js";
import {
  badgeStyle,
  buttonStyle,
  cardStyle,
  listItemStyle,
  listStyle,
  mutedStyle,
  pageStyle,
  titleStyle,
} from "../projects/ui.js";
import {
  asWorkflowView,
  catalogListCard,
  rejectWorkflowCanvas,
  stepKindLabel,
  versionById,
  workflowById,
  workflowPageModel,
  type WorkflowCatalogSource,
  type WorkflowStepView,
  type WorkflowTemplateView,
  type WorkflowVersionView,
} from "./model.js";

export function WorkflowsPage(props: FeaturePageProps) {
  const client = useWorkforceClient();
  const initial = workflowPageModel({ status: "loading" });
  const [workflows, setWorkflows] = useState<WorkflowTemplateView[]>(initial.workflows);
  const [note, setNote] = useState(initial.note);
  const [source, setSource] = useState<WorkflowCatalogSource>(initial.source);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (props.params.workflowId) {
          const dto: WorkflowDto = await client.getWorkflow(props.params.workflowId);
          const parsed = asWorkflowView(dto);
          if (cancelled) {
            return;
          }
          const model = workflowPageModel({
            liveWorkflows: parsed ? [parsed] : [],
            status: parsed ? "ok" : "empty",
          });
          setWorkflows(model.workflows);
          setNote(model.note);
          setSource(model.source);
          return;
        }
        const page = await client.listWorkflows();
        const parsed = page.items
          .map(asWorkflowView)
          .filter((item): item is WorkflowTemplateView => item !== null);
        if (cancelled) {
          return;
        }
        const model = workflowPageModel({ liveWorkflows: parsed, status: "ok" });
        setWorkflows(model.workflows);
        setNote(model.note);
        setSource(model.source);
      } catch {
        if (!cancelled) {
          const model = workflowPageModel({ status: "error" });
          setWorkflows(model.workflows);
          setNote(model.note);
          setSource(model.source);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, props.params.workflowId]);

  const workflowId = props.params.workflowId;
  if (workflowId) {
    const workflow = workflowById(workflows, workflowId);
    return (
      <WorkflowDetailPage
        workflow={workflow}
        versionId={props.params.versionId}
        note={note}
        source={source}
        navigate={props.navigate}
      />
    );
  }

  return (
    <main style={pageStyle}>
      <h1 style={titleStyle}>工作流</h1>
      <p style={mutedStyle}>{note}</p>
      <p style={mutedStyle}>模板、版本和结构化步骤（只读目录）。画布编辑器尚未实现。</p>
      <section style={cardStyle}>
        {workflows.length === 0 ? (
          <CatalogListStatus source={source} />
        ) : (
          <ul style={listStyle}>
            {workflows.map((workflow) => {
              const version = versionById(workflow, undefined);
              return (
                <li
                  key={workflow.id}
                  style={listItemStyle}
                  data-testid={`workflow-row-${workflow.id}`}
                  onClick={() => props.navigate(`/workflows/${workflow.id}`)}
                >
                  <strong>{workflow.name}</strong>
                  <div style={mutedStyle}>
                    {workflow.id} · 版本 {version?.version ?? workflow.activeVersionId} ·{" "}
                    {version?.steps.length ?? 0} 步
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

function CatalogListStatus(props: { source: WorkflowCatalogSource }) {
  const card = catalogListCard(props.source);
  return (
    <p style={mutedStyle} data-testid={card.testId}>
      {card.text}
    </p>
  );
}

function WorkflowDetailPage(props: {
  workflow: WorkflowTemplateView | null;
  versionId?: string | undefined;
  note: string;
  source: WorkflowCatalogSource;
  navigate: (path: string) => void;
}) {
  if (!props.workflow) {
    return (
      <main style={pageStyle}>
        <p>
          <button
            type="button"
            style={buttonStyle("secondary")}
            onClick={() => props.navigate("/workflows")}
          >
            返回工作流
          </button>
        </p>
        <p>{props.source === "loading" ? props.note : "未找到该工作流模板。"}</p>
        {props.source === "unavailable" ? <p style={mutedStyle}>{props.note}</p> : null}
      </main>
    );
  }

  const selected = versionById(props.workflow, props.versionId);
  const canvas = rejectWorkflowCanvas();
  const versionRoute = Boolean(props.versionId);
  const sourceLabel =
    props.source === "live" ? "GET /workflows" : props.source === "empty" ? "空目录" : "目录未加载";

  return (
    <main style={pageStyle}>
      <p>
        <button
          type="button"
          style={buttonStyle("secondary")}
          onClick={() =>
            props.navigate(versionRoute ? `/workflows/${props.workflow?.id}` : "/workflows")
          }
        >
          {versionRoute ? "返回工作流详情" : "返回工作流"}
        </button>
      </p>
      <section style={cardStyle} data-testid="workflow-detail">
        <h1 style={titleStyle}>{props.workflow.name}</h1>
        <div style={{ marginBottom: "var(--wf-space-md, 12px)" }}>
          <span style={badgeStyle("muted")}>只读</span>
        </div>
        <p style={mutedStyle}>{props.workflow.description}</p>
        <p style={mutedStyle}>
          来源 {sourceLabel} · 活动版本 {props.workflow.activeVersionId}
        </p>
        <p style={mutedStyle}>{props.note}</p>
        <p style={mutedStyle}>{canvas.reason}</p>
        <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>版本</h2>
        <ul style={listStyle}>
          {props.workflow.versions.map((version) => (
            <li
              key={version.id}
              style={listItemStyle}
              data-testid={`workflow-version-${version.id}`}
              onClick={() =>
                props.navigate(`/workflows/${props.workflow?.id}/versions/${version.id}`)
              }
            >
              <strong>
                {version.version} · {version.status === "published" ? "已发布" : "草稿"}
              </strong>
              <div style={mutedStyle}>
                不可变 · 入口 {version.entry} · {version.steps.length} 步
              </div>
            </li>
          ))}
        </ul>
        {selected ? <StructuredSteps version={selected} /> : <p>未找到该版本。</p>}
      </section>
    </main>
  );
}

export function StructuredSteps(props: { version: WorkflowVersionView }) {
  return (
    <section data-testid="workflow-steps">
      <h2 style={{ ...titleStyle, fontSize: "var(--wf-font-body, 16px)" }}>
        结构化步骤 · {props.version.version}
      </h2>
      <ol style={{ ...listStyle, paddingLeft: "var(--wf-space-lg, 16px)" }}>
        {props.version.steps.map((step, index) => (
          <WorkflowStepRow key={step.id} step={step} index={index} />
        ))}
      </ol>
    </section>
  );
}

function WorkflowStepRow(props: { step: WorkflowStepView; index: number }) {
  const meta = [
    stepKindLabel(props.step.kind),
    props.step.worker ? `Worker ${props.step.worker}` : null,
    props.step.gate ? `gate ${props.step.gate}` : null,
  ]
    .filter((item): item is string => item !== null)
    .join(" · ");
  return (
    <li
      style={{ ...listItemStyle, cursor: "default" }}
      data-testid={`workflow-step-${props.step.id}`}
    >
      <strong>
        {props.index + 1}. {props.step.title}
      </strong>
      <div style={mutedStyle}>{meta}</div>
      {props.step.notes.length > 0 ? (
        <div style={mutedStyle}>{props.step.notes.join(" · ")}</div>
      ) : null}
    </li>
  );
}
