import { useEffect, useState } from "react";
import type { PageDto } from "@workforce/desktop-client";

import type { FeaturePageProps } from "../contract.js";
import { asCatalogClient, hasCatalogMethod, useWorkforceClient } from "../hooks.js";
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
  FEATURE_DELIVERY_WORKFLOW,
  rejectWorkflowCanvas,
  stepKindLabel,
  versionById,
  workflowById,
  workflowPageModel,
  type WorkflowStepView,
  type WorkflowTemplateView,
  type WorkflowVersionView,
} from "./model.js";

export function WorkflowsPage(props: FeaturePageProps) {
  const client = useWorkforceClient();
  const [workflows, setWorkflows] = useState<WorkflowTemplateView[]>([FEATURE_DELIVERY_WORKFLOW]);
  const [note, setNote] = useState<string | null>(workflowPageModel().note);
  const [source, setSource] = useState<"preset" | "live">("preset");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const catalog = asCatalogClient(client);
      if (!hasCatalogMethod(catalog, "listWorkflows")) {
        return;
      }
      try {
        const page: PageDto<unknown> = await catalog.listWorkflows();
        const parsed = page.items
          .map(asWorkflowView)
          .filter((item): item is WorkflowTemplateView => item !== null);
        if (!cancelled && parsed.length > 0) {
          const model = workflowPageModel({ liveWorkflows: parsed });
          setWorkflows(model.workflows);
          setNote(model.note);
          setSource(model.source);
        }
      } catch {
        if (!cancelled) {
          const model = workflowPageModel();
          setWorkflows(model.workflows);
          setNote(model.note);
          setSource(model.source);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const workflowId = props.params.workflowId;
  if (workflowId) {
    const workflow =
      workflowById(workflows, workflowId) ??
      (workflowId === FEATURE_DELIVERY_WORKFLOW.id ? FEATURE_DELIVERY_WORKFLOW : null);
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
      {note ? <p style={mutedStyle}>{note}</p> : null}
      <p style={mutedStyle}>模板、版本和结构化步骤。V0.1 没有画布编辑器。</p>
      <section style={cardStyle}>
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
      </section>
    </main>
  );
}

function WorkflowDetailPage(props: {
  workflow: WorkflowTemplateView | null;
  versionId?: string | undefined;
  note: string | null;
  source: "preset" | "live";
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
        <p>未找到该工作流模板。</p>
      </main>
    );
  }

  const selected = versionById(props.workflow, props.versionId);
  const canvas = rejectWorkflowCanvas();
  const versionRoute = Boolean(props.versionId);

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
          来源 {props.source === "live" ? "typed catalog" : "模板夹具"} · 活动版本{" "}
          {props.workflow.activeVersionId}
        </p>
        {props.note ? <p style={mutedStyle}>{props.note}</p> : null}
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
