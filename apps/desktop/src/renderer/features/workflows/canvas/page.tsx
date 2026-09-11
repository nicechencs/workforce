import { useEffect, useReducer, type CSSProperties, type ReactNode } from "react";
import type { WorkflowDto } from "@workforce/desktop-client";

import {
  buttonStyle,
  cardStyle,
  errorStyle,
  inputStyle,
  labelStyle,
  mutedStyle,
  pageStyle,
  titleStyle,
  warningStyle,
} from "../../projects/ui.js";
import { useWorkforceClient } from "../../hooks.js";
import { toGraphPayload } from "../graph/types.js";
import { asWorkflowView, versionById, type WorkflowTemplateView } from "../model.js";
import { persistWorkflowDraft, publishWorkflowDraft } from "../write-client.js";
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
  persistStatusLabel,
  reduceCanvasSession,
  sessionFromBlank,
  sessionFromDraftVersion,
  sessionFromFork,
  type CanvasSession,
} from "./model.js";
import { canvasDraftSteps } from "./model.js";
import { WorkflowCanvasToolbar } from "./toolbar.js";

const layout: CSSProperties = {
  display: "flex",
  gap: "var(--wf-space-lg, 16px)",
  alignItems: "flex-start",
  flexWrap: "wrap",
};

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
    const result = await persistWorkflowDraft(client, {
      workflowId: session.draft.workflowId,
      versionId: session.draft.versionId,
      name: session.draft.name.trim() || "未命名工作流",
      description: session.draft.description,
      graph: toGraphPayload(session.draft.graph),
      steps: canvasDraftSteps(session),
    });
    if (!result.ok) {
      dispatch({
        type: "saveFailed",
        error: result.error,
        workflowId: result.workflowId,
        versionId: result.versionId,
      });
      return;
    }
    dispatch({ type: "saveSucceeded", workflowId: result.workflowId, versionId: result.versionId });
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
    const result = await publishWorkflowDraft(client, { workflowId, versionId });
    if (!result.ok) {
      dispatch({ type: "publishFailed", error: result.error });
      return;
    }
    dispatch({ type: "publishSucceeded" });
  }

  const title =
    props.workflowId === CANVAS_NEW_WORKFLOW_ID ? CANVAS_PAGE_TITLE_NEW : CANVAS_PAGE_TITLE_EDIT;
  const frozen = session.mode === "readonly-frozen";

  return (
    <main style={pageStyle} data-testid="workflow-canvas-page">
      <p>
        <button
          type="button"
          style={buttonStyle("secondary")}
          onClick={() =>
            props.navigate(
              session.draft.workflowId && session.draft.workflowId !== CANVAS_NEW_WORKFLOW_ID
                ? `/workflows/${session.draft.workflowId}`
                : "/workflows",
            )
          }
        >
          返回工作流
        </button>
      </p>
      <section style={cardStyle}>
        <h1 style={titleStyle}>{title}</h1>
        <p style={mutedStyle} data-testid="workflow-canvas-loop-note">
          {PROJECT_LOOP_NOTE}
        </p>
        <p style={warningStyle} data-testid="workflow-unpublished-note">
          {frozen ? session.banner : UNPUBLISHED_RUNTIME_NOTE}
        </p>
        <p style={mutedStyle}>{SAVE_PRESERVE_NOTE}</p>
        <p style={mutedStyle} data-testid="workflow-canvas-write-note">
          {session.write.note}
        </p>
        <p style={mutedStyle} data-testid="workflow-canvas-persist">
          {persistStatusLabel(session.persist)}
        </p>
        {session.persistError ? (
          <div style={errorStyle} data-testid="workflow-canvas-error">
            {session.persistError}
          </div>
        ) : null}
        {session.connectError ? (
          <div style={errorStyle} data-testid="workflow-canvas-connect-error">
            {session.connectError}
          </div>
        ) : null}
        <label style={labelStyle} htmlFor="wf-canvas-name">
          名称
        </label>
        <input
          id="wf-canvas-name"
          data-testid="workflow-canvas-name"
          style={inputStyle}
          disabled={frozen}
          value={session.draft.name}
          onChange={(event) =>
            dispatch({ type: "setMeta", field: "name", value: event.target.value })
          }
        />
        <label style={labelStyle} htmlFor="wf-canvas-description">
          说明
        </label>
        <textarea
          id="wf-canvas-description"
          data-testid="workflow-canvas-description"
          style={{ ...inputStyle, minHeight: 72 }}
          disabled={frozen}
          value={session.draft.description}
          onChange={(event) =>
            dispatch({ type: "setMeta", field: "description", value: event.target.value })
          }
        />
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
          <ul
            data-testid="workflow-canvas-validation"
            style={{ color: "var(--wf-color-danger, #b91c1c)" }}
          >
            {session.validation.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : (
          <p style={mutedStyle} data-testid="workflow-canvas-validation-ok">
            有限 DAG 校验通过（发布仍以服务端 T09 为准）。
          </p>
        )}
        <div style={layout}>
          <div style={{ flex: "1 1 520px" }}>
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
          </div>
          <WorkflowCanvasInspector session={session} dispatch={dispatch} />
        </div>
      </section>
    </main>
  );
}

export async function loadCanvasSession(
  client: { getWorkflow: (id: string) => Promise<WorkflowDto> },
  workflowId: string,
  versionId?: string | undefined,
): Promise<CanvasSession> {
  if (workflowId === CANVAS_NEW_WORKFLOW_ID) {
    return sessionFromBlank(client);
  }
  const dto = await client.getWorkflow(workflowId);
  const workflow = asWorkflowView(dto);
  if (!workflow) {
    return sessionFromBlank(client);
  }
  if (versionId === CANVAS_DRAFT_VERSION_ID || versionId === undefined) {
    const existingDraft = workflow.versions.find((item) => item.status === "draft") ?? null;
    if (existingDraft && versionId === CANVAS_DRAFT_VERSION_ID) {
      return sessionFromDraftVersion({ client, workflow, version: existingDraft });
    }
    if (versionId === CANVAS_DRAFT_VERSION_ID) {
      return sessionFromFork({
        client,
        workflow,
        source: versionById(workflow, workflow.activeVersionId),
      });
    }
  }
  const selected = versionById(workflow, versionId);
  if (selected?.status === "draft") {
    return sessionFromDraftVersion({ client, workflow, version: selected });
  }
  return sessionFromFork({ client, workflow, source: selected });
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
  if (params.workflow && params.versionId) {
    const version = versionById(params.workflow, params.versionId);
    return version?.status === "draft";
  }
  return false;
}
