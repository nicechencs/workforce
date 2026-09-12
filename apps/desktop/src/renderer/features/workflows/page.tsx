import { useEffect, useState } from "react";
import type { WorkflowDto } from "@workforce/desktop-client";

import { Badge, Button, Card, List, ListRow, Muted, Page } from "../../components/ui.js";
import type { FeaturePageProps } from "../contract.js";
import { useWorkforceClient } from "../hooks.js";
import {
  WorkflowAuthoringEntry,
  WorkflowAuthoringPage,
  isWorkflowAuthoringHash,
} from "../workflow-authoring/index.js";
import { WorkflowCanvasPage, shouldOpenCanvas } from "./canvas/page.js";
import {
  canvasCreatePath,
  canvasDraftPath,
  workflowCatalogPath,
  workflowDetailPath,
} from "./canvas/model.js";
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
  const [authoringHash, setAuthoringHash] = useState<string | null>(() => {
    if (typeof window === "undefined" || !isWorkflowAuthoringHash(window.location.hash)) {
      return null;
    }
    return window.location.hash;
  });

  useEffect(() => {
    const sync = (): void => {
      const hash = window.location.hash;
      setAuthoringHash(isWorkflowAuthoringHash(hash) ? hash : null);
    };
    window.addEventListener("hashchange", sync);
    sync();
    return () => {
      window.removeEventListener("hashchange", sync);
    };
  }, []);

  const selectedWorkflow =
    props.params.workflowId === undefined
      ? null
      : workflowById(workflows, props.params.workflowId);
  const openCanvas = shouldOpenCanvas({
    workflowId: props.params.workflowId,
    versionId: props.params.versionId,
    workflow: selectedWorkflow,
  });

  useEffect(() => {
    let cancelled = false;
    if (props.params.workflowId === "new" || props.params.versionId === "draft") {
      return;
    }
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
  }, [client, props.params.workflowId, props.params.versionId]);

  if (authoringHash !== null) {
    // The full hash is an authoring-session boundary. In particular,
    // `projectId=prj_a` → `projectId=prj_b` must not retain A's form or
    // local messages while B hydrates.
    return <WorkflowAuthoringPage key={authoringHash} {...props} path={authoringHash} />;
  }
  if (openCanvas) {
    return (
      <WorkflowCanvasPage
        workflowId={props.params.workflowId ?? "new"}
        versionId={props.params.versionId}
        navigate={props.navigate}
      />
    );
  }

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
    <Page
      title="工作流"
      subtitle="模板、版本和结构化步骤。已发布版本只读；未发布草稿走画布。"
      actions={
        <Button testId="workflow-new-canvas" onClick={() => props.navigate(canvasCreatePath())}>
          新建画布
        </Button>
      }
    >
      <Muted>{note}</Muted>
      <WorkflowAuthoringEntry navigate={props.navigate} />
      <Card>
        {workflows.length === 0 ? (
          <CatalogListStatus source={source} />
        ) : (
          <List>
            {workflows.map((workflow) => {
              const version = versionById(workflow, undefined);
              return (
                <ListRow
                  key={workflow.id}
                  testId={`workflow-row-${workflow.id}`}
                  title={workflow.name}
                  meta={`${workflow.id} · ${
                    version?.status === "published" ? "已发布" : "草稿"
                  } ${version?.version ?? workflow.activeVersionId} · ${
                    version?.steps.length ?? 0
                  } 步`}
                  onClick={() => props.navigate(`/workflows/${workflow.id}`)}
                />
              );
            })}
          </List>
        )}
      </Card>
    </Page>
  );
}

function CatalogListStatus(props: { source: WorkflowCatalogSource }) {
  const card = catalogListCard(props.source);
  return (
    <Muted>
      <span data-testid={card.testId}>{card.text}</span>
    </Muted>
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
      <Page
        title="工作流"
        actions={<Button onClick={() => props.navigate(workflowCatalogPath())}>返回工作流</Button>}
      >
        <Card>
          <p>{props.source === "loading" ? props.note : "未找到该工作流模板。"}</p>
          {props.source === "unavailable" ? <Muted>{props.note}</Muted> : null}
        </Card>
      </Page>
    );
  }

  const workflow = props.workflow;
  const selected = versionById(workflow, props.versionId);
  const canvas = rejectWorkflowCanvas();
  const versionRoute = Boolean(props.versionId);
  const sourceLabel =
    props.source === "live" ? "GET /workflows" : props.source === "empty" ? "空目录" : "目录未加载";

  return (
    <Page
      title={workflow.name}
      actions={
        <>
          <Button
            testId="workflow-fork-canvas"
            onClick={() => props.navigate(canvasDraftPath(workflow.id))}
          >
            复制到画布
          </Button>
          <Button
            onClick={() =>
              props.navigate(versionRoute ? workflowDetailPath(workflow.id) : workflowCatalogPath())
            }
          >
            {versionRoute ? "返回工作流详情" : "返回工作流"}
          </Button>
        </>
      }
    >
      <Card testId="workflow-detail">
        <div className="wf-cluster">
          <Badge tone="muted">只读</Badge>
          <Muted>
            来源 {sourceLabel} · 活动版本 {workflow.activeVersionId}
          </Muted>
        </div>
        <Muted>{workflow.description}</Muted>
        <Muted>{props.note}</Muted>
        <Muted>{canvas.reason}</Muted>
        <h2 className="wf-section-title">版本</h2>
        <List>
          {workflow.versions.map((version) => (
            <ListRow
              key={version.id}
              testId={`workflow-version-${version.id}`}
              title={`${version.version} · ${version.status === "published" ? "已发布" : "草稿"}`}
              meta={`${
                version.status === "published" ? "不可变" : "未发布，Runtime 不会执行"
              } · 入口 ${version.entry} · ${version.steps.length} 步`}
              onClick={() => props.navigate(canvasDraftPath(workflow.id, version.id))}
            />
          ))}
        </List>
        {selected ? <StructuredSteps version={selected} /> : <p>未找到该版本。</p>}
      </Card>
    </Page>
  );
}

export function StructuredSteps(props: { version: WorkflowVersionView }) {
  return (
    <section data-testid="workflow-steps">
      <h2 className="wf-section-title">结构化步骤 · {props.version.version}</h2>
      <ol className="wf-timeline">
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
    <li className="wf-timeline-row" data-testid={`workflow-step-${props.step.id}`}>
      <span className="wf-list-row-title">
        {props.index + 1}. {props.step.title}
      </span>
      <span className="wf-list-row-meta">{meta}</span>
      {props.step.notes.length > 0 ? (
        <span className="wf-list-row-meta">{props.step.notes.join(" · ")}</span>
      ) : null}
    </li>
  );
}
