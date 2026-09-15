import { useEffect, useState } from "react";
import type { WorkflowDto } from "@workforce/desktop-client";

import { Badge, Button, Card, EmptyState, List, ListRow, LoadingText, Muted, Notice, Page } from "../../components/ui.js";
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
  CATALOG_OBJECT_NOTE,
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

  if (authoringHash !== null || props.params.workflowId === "authoring") {
    // The full hash is an authoring-session boundary. In particular,
    // `projectId=prj_a` → `projectId=prj_b` must not retain A's form or
    // local messages while B hydrates.
    const hash = authoringHash ?? "#/workflows/authoring";
    return <WorkflowAuthoringPage key={hash} {...props} path={hash} />;
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
      subtitle="图版本目录。已发布版本只读；未发布草稿走画布。执行只走已发布 WorkflowVersion。"
      actions={
        <Button
          variant="primary"
          testId="workflow-new-canvas"
          onClick={() => props.navigate(canvasCreatePath())}
        >
          新建画布
        </Button>
      }
    >
      <Muted>{CATALOG_OBJECT_NOTE}</Muted>
      <Muted>{note}</Muted>
      <WorkflowAuthoringEntry navigate={props.navigate} />
      <Card>
        {workflows.length === 0 ? (
          <CatalogListStatus source={source} />
        ) : (
          <List>
            {workflows.map((workflow) => {
              const version = versionById(workflow, undefined);
              const published = version?.status === "published";
              return (
                <ListRow
                  key={workflow.id}
                  testId={`workflow-row-${workflow.id}`}
                  title={workflow.name}
                  meta={`${workflow.id} · ${
                    published ? "已发布" : "草稿"
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
  if (props.source === "loading") {
    return (
      <LoadingText>
        <span data-testid={card.testId}>{card.text}</span>
      </LoadingText>
    );
  }
  if (props.source === "unavailable") {
    return (
      <EmptyState title="目录未加载" testId={card.testId}>
        {card.text}
      </EmptyState>
    );
  }
  return (
    <EmptyState title="还没有已发布的工作流" testId={card.testId}>
      {card.text} 用页头「新建画布」创建未发布草稿，或打开对话生成。
    </EmptyState>
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
        actions={<Button variant="outline" onClick={() => props.navigate(workflowCatalogPath())}>返回工作流</Button>}
      >
        <Card>
          {props.source === "loading" ? (
            <LoadingText>{props.note}</LoadingText>
          ) : (
            <EmptyState title="未找到该工作流模板。">
              {props.source === "unavailable" ? props.note : "目录里没有这条 identity。"}
            </EmptyState>
          )}
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
  const published = selected?.status === "published";
  const hasDraft = workflow.versions.some((item) => item.status === "draft");
  const canvasActionLabel = hasDraft && !versionRoute ? "打开草稿画布" : "复制到画布";

  return (
    <Page
      title={workflow.name}
      subtitle="已发布版本只读。要改流程请复制到未发布画布。"
      actions={
        <>
          <Button
            variant="outline"
            onClick={() =>
              props.navigate(versionRoute ? workflowDetailPath(workflow.id) : workflowCatalogPath())
            }
          >
            {versionRoute ? "返回工作流详情" : "返回工作流"}
          </Button>
          <Button
            testId="workflow-fork-canvas"
            onClick={() => props.navigate(canvasDraftPath(workflow.id))}
          >
            {canvasActionLabel}
          </Button>
        </>
      }
    >
      <Card testId="workflow-detail" title="身份">
        <div className="wf-cluster">
          <Badge tone={published ? "success" : "warning"}>{published ? "已发布" : "草稿"}</Badge>
          <Badge tone="muted">只读目录</Badge>
          <Muted>
            来源 {sourceLabel} · 活动版本 {workflow.activeVersionId}
          </Muted>
        </div>
        <Muted>{workflow.description || "说明未返回"}</Muted>
        <Muted>{props.note}</Muted>
        <Muted>{canvas.reason}</Muted>
        {selected?.status !== "published" ? (
          <Notice tone="warning" title="未发布">
            Runtime 不会执行此版本。确认发布后才能给项目用。
          </Notice>
        ) : (
          <Notice tone="info" title="不可变版本">
            项目执行若绑定此版本，不会在画布上原地改。复制到画布会生成新的未发布 version。
          </Notice>
        )}
      </Card>
      <Card title="版本">
        {workflow.versions.length === 0 ? (
          <EmptyState title="没有版本">目录未返回 version。不会回退夹具。</EmptyState>
        ) : (
          <List>
            {workflow.versions.map((version) => (
              <ListRow
                key={version.id}
                testId={`workflow-version-${version.id}`}
                title={`${version.version} · ${version.status === "published" ? "已发布" : "草稿"}`}
                meta={`${
                  version.status === "published" ? "不可变" : "未发布，Runtime 不会执行"
                } · 入口 ${version.entry || "未返回"} · ${version.steps.length} 步`}
                onClick={() =>
                  props.navigate(`/workflows/${workflow.id}/versions/${version.id}`)
                }
              />
            ))}
          </List>
        )}
      </Card>
      <Card>
        {selected ? (
          <StructuredSteps version={selected} />
        ) : (
          <EmptyState title="未找到该版本。">版本行打开详情，不会进画布。</EmptyState>
        )}
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
