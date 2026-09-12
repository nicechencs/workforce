import { useEffect, useReducer, type ReactNode } from "react";
import type { WorkflowDto, WorkflowVersionDto } from "@workforce/desktop-client";

import {
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Muted,
  Notice,
  Page,
  Textarea,
} from "../../../components/ui.js";
import { useWorkforceClient } from "../../hooks.js";
import { toGraphPayload } from "../graph/types.js";
import { asVersionView, asWorkflowView, versionById, type WorkflowTemplateView } from "../model.js";
import { persistWorkflowDraft, publishWorkflowDraft, writeErrorMessage } from "../write-client.js";
import { WorkflowCanvasEditor } from "./editor.js";
import { WorkflowCanvasInspector } from "./inspector.js";
import {
  CANVAS_PAGE_TITLE_EDIT,
  CANVAS_PAGE_TITLE_NEW,
  PROJECT_LOOP_NOTE,
  SAVE_PRESERVE_NOTE,
  UNPUBLISHED_RUNTIME_NOTE,
} from "./copy.js";
import {
  CANVAS_DRAFT_VERSION_ID,
  CANVAS_NEW_WORKFLOW_ID,
  canvasDraftPath,
  isPublishedVersionFrozen,
  persistStatusLabel,
  reduceCanvasSession,
  sessionFromBlank,
  sessionFromDraftVersion,
  sessionFromFork,
  workflowCatalogPath,
  workflowDetailPath,
  type CanvasSession,
} from "./model.js";
import { canvasDraftSteps } from "./model.js";
import { WorkflowCanvasToolbar } from "./toolbar.js";

export function WorkflowCanvasPage(props: {
  workflowId: string;
  versionId?: string | undefined;
  navigate: (path: string) => void;
}): ReactNode {
  const client = useWorkforceClient();
  const [session, dispatch] = useReducer(reduceCanvasSession, undefined, () =>
    sessionFromBlank(client),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await loadCanvasSession(client, props.workflowId, props.versionId);
      if (!cancelled) {
        dispatch({ type: "hydrate", session: next });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, props.workflowId, props.versionId]);

  async function onSave(): Promise<void> {
    dispatch({ type: "saveStart" });
    const started = reduceCanvasSession(session, { type: "saveStart" });
    if (started.persist === "error") {
      dispatch({ type: "saveFailed", error: started.persistError ?? "无法保存" });
      return;
    }
    const persistInput: Parameters<typeof persistWorkflowDraft>[1] = {
      workflowId: session.draft.workflowId,
      versionId: session.draft.versionId,
      name: session.draft.name.trim() || "未命名工作流",
      description: session.draft.description,
      graph: toGraphPayload(session.draft.graph),
      steps: canvasDraftSteps(session),
    };
    if (
      session.draft.definitionRevision !== undefined ||
      session.draft.versionRevision !== undefined
    ) {
      persistInput.revisions = {
        ...(session.draft.definitionRevision === undefined
          ? {}
          : { definitionRevision: session.draft.definitionRevision }),
        ...(session.draft.versionRevision === undefined
          ? {}
          : { versionRevision: session.draft.versionRevision }),
      };
    }
    if (session.draft.definitionStatus !== undefined) {
      persistInput.definitionStatus = session.draft.definitionStatus;
    }
    if (session.draft.versionStatus !== undefined) {
      persistInput.versionStatus = session.draft.versionStatus;
    }
    const result = await persistWorkflowDraft(client, persistInput);
    if (!result.ok) {
      dispatch({
        type: "saveFailed",
        error: result.error,
        workflowId: result.workflowId,
        versionId: result.versionId,
      });
      return;
    }
    dispatch({
      type: "saveSucceeded",
      workflowId: result.workflowId,
      versionId: result.versionId,
      definitionRevision: result.revisions.definitionRevision,
      versionRevision: result.revisions.versionRevision,
    });
    const nextPath = canvasDraftPath(result.workflowId);
    const alreadyOnDraftCanvas =
      props.workflowId === result.workflowId &&
      (props.versionId === CANVAS_DRAFT_VERSION_ID || props.versionId === result.versionId);
    if (!alreadyOnDraftCanvas) {
      props.navigate(nextPath);
    }
  }

  async function onPublish(): Promise<void> {
    dispatch({ type: "publishStart" });
    const started = reduceCanvasSession(session, { type: "publishStart" });
    if (started.persist === "error") {
      dispatch({ type: "publishFailed", error: started.persistError ?? "无法发布" });
      return;
    }
    const workflowId = session.draft.workflowId;
    const versionId = session.draft.versionId;
    if (!workflowId || !versionId) {
      dispatch({ type: "publishFailed", error: "缺少已保存的 workflowId / versionId，不能发布。" });
      return;
    }
    const result = await publishWorkflowDraft(client, {
      workflowId,
      versionId,
      ...(session.draft.versionRevision === undefined
        ? {}
        : { versionRevision: session.draft.versionRevision }),
    });
    if (!result.ok) {
      dispatch({ type: "publishFailed", error: result.error });
      return;
    }
    dispatch({ type: "publishSucceeded" });
    props.navigate(workflowCatalogPath());
  }

  const title =
    props.workflowId === CANVAS_NEW_WORKFLOW_ID ? CANVAS_PAGE_TITLE_NEW : CANVAS_PAGE_TITLE_EDIT;
  const frozen = session.mode === "readonly-frozen";

  return (
    <Page
      title={title}
      testId="workflow-canvas-page"
      actions={
        <Button
          onClick={() =>
            props.navigate(
              session.draft.workflowId && session.draft.workflowId !== CANVAS_NEW_WORKFLOW_ID
                ? workflowDetailPath(session.draft.workflowId)
                : workflowCatalogPath(),
            )
          }
        >
          返回工作流
        </Button>
      }
    >
      <Card>
        <Muted>
          <span data-testid="workflow-canvas-loop-note">{PROJECT_LOOP_NOTE}</span>
        </Muted>
        <Notice tone="warning">
          <span data-testid="workflow-unpublished-note">
            {frozen ? session.banner : UNPUBLISHED_RUNTIME_NOTE}
          </span>
        </Notice>
        <Muted>{SAVE_PRESERVE_NOTE}</Muted>
        <Muted>
          <span data-testid="workflow-canvas-write-note">{session.write.note}</span>
        </Muted>
        <Muted>
          <span data-testid="workflow-canvas-persist">{persistStatusLabel(session.persist)}</span>
        </Muted>
        {session.persistError ? (
          <div data-testid="workflow-canvas-error">
            <ErrorText>{session.persistError}</ErrorText>
          </div>
        ) : null}
        {session.connectError ? (
          <div data-testid="workflow-canvas-connect-error">
            <ErrorText>{session.connectError}</ErrorText>
          </div>
        ) : null}
        <Field label="名称" htmlFor="wf-canvas-name">
          <Input
            id="wf-canvas-name"
            testId="workflow-canvas-name"
            disabled={frozen}
            value={session.draft.name}
            onChange={(event) =>
              dispatch({ type: "setMeta", field: "name", value: event.target.value })
            }
          />
        </Field>
        <Field label="说明" htmlFor="wf-canvas-description">
          <Textarea
            id="wf-canvas-description"
            testId="workflow-canvas-description"
            disabled={frozen}
            value={session.draft.description}
            onChange={(event) =>
              dispatch({ type: "setMeta", field: "description", value: event.target.value })
            }
          />
        </Field>
        <WorkflowCanvasToolbar
          session={session}
          dispatch={dispatch}
          onSave={() => {
            void onSave();
          }}
          onPublish={() => {
            void onPublish();
          }}
        />
        {!session.validation.ok ? (
          <ul data-testid="workflow-canvas-validation" className="wf-validation-list">
            {session.validation.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : (
          <Muted>
            <span data-testid="workflow-canvas-validation-ok">
              有限 DAG 校验通过（发布仍以服务端 T09 为准）。
            </span>
          </Muted>
        )}
        <div className="wf-split">
          <WorkflowCanvasEditor
            session={session}
            onSelectNode={(nodeId) => dispatch({ type: "selectNode", nodeId })}
            onSelectEdge={(edgeId) => dispatch({ type: "selectEdge", edgeId })}
            onNodeClick={(nodeId) => {
              if (session.connectFrom && session.connectFrom !== nodeId) {
                dispatch({ type: "completeConnect", nodeId });
                return;
              }
              dispatch({ type: "selectNode", nodeId });
            }}
          />
          <WorkflowCanvasInspector session={session} dispatch={dispatch} />
        </div>
      </Card>
    </Page>
  );
}

export async function loadCanvasSession(
  client: {
    getWorkflow: (id: string) => Promise<WorkflowDto>;
    getWorkflowVersion?: (id: string, versionId: string) => Promise<WorkflowVersionDto>;
  },
  workflowId: string,
  versionId?: string | undefined,
): Promise<CanvasSession> {
  if (workflowId === CANVAS_NEW_WORKFLOW_ID) {
    return sessionFromBlank(client);
  }
  try {
    const dto = await client.getWorkflow(workflowId);
    const workflow = asWorkflowView(dto);
    if (!workflow) {
      return sessionLoadError(client, "无法解析工作流定义。");
    }
    if (versionId === CANVAS_DRAFT_VERSION_ID) {
      const existingDraft = workflow.versions.find((item) => item.status === "draft") ?? null;
      if (existingDraft) {
        return sessionFromDraftVersion({
          client,
          workflow,
          version: await hydrateVersionGraph(client, workflow.id, existingDraft),
        });
      }
      return sessionFromFork({
        client,
        workflow,
        source: versionById(workflow, workflow.activeVersionId),
      });
    }
    const selected = versionById(workflow, versionId);
    if (selected?.status === "draft") {
      return sessionFromDraftVersion({
        client,
        workflow,
        version: await hydrateVersionGraph(client, workflow.id, selected),
      });
    }
    if (selected && isPublishedVersionFrozen(selected)) {
      return sessionFromDraftVersion({
        client,
        workflow,
        version: await hydrateVersionGraph(client, workflow.id, selected),
      });
    }
    return sessionFromFork({ client, workflow, source: selected });
  } catch (error) {
    return sessionLoadError(client, writeErrorMessage(error));
  }
}

function sessionLoadError(client: unknown, error: string): CanvasSession {
  const fallback = sessionFromBlank(client);
  return {
    ...fallback,
    persist: "error",
    persistError: error,
    connectError: error,
  };
}

async function hydrateVersionGraph(
  client: {
    getWorkflowVersion?: (id: string, versionId: string) => Promise<WorkflowVersionDto>;
  },
  workflowId: string,
  version: NonNullable<ReturnType<typeof versionById>>,
): Promise<NonNullable<ReturnType<typeof versionById>>> {
  if (version.graph && version.graph.nodes.length > 0) {
    return version;
  }
  if (typeof client.getWorkflowVersion !== "function") {
    return version;
  }
  const detailed = asVersionView(await client.getWorkflowVersion(workflowId, version.id));
  if (!detailed) {
    return version;
  }
  const merged = { ...version, ...detailed };
  const graph = detailed.graph ?? version.graph;
  if (graph === undefined) {
    return merged;
  }
  return { ...merged, graph };
}

export function shouldOpenCanvas(params: {
  workflowId?: string | undefined;
  versionId?: string | undefined;
  workflow?: WorkflowTemplateView | null | undefined;
}): boolean {
  if (params.workflowId === CANVAS_NEW_WORKFLOW_ID) {
    return true;
  }
  if (params.versionId === CANVAS_DRAFT_VERSION_ID) {
    return true;
  }
  if (!params.workflowId || !params.versionId || !params.workflow) {
    return false;
  }
  const version = versionById(params.workflow, params.versionId);
  if (!version || isPublishedVersionFrozen(version) || version.status === "published") {
    return false;
  }
  return version.status === "draft";
}
