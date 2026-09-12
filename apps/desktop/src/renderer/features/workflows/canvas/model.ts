import { graphFromSteps, graphFromVersion, stepsFromGraph } from "../graph/from-catalog.js";
import {
  addNode,
  connectNodes,
  moveNode,
  removeEdge,
  removeNode,
  setEntryNode,
  unsetNodeFields,
  updateNode,
} from "../graph/operations.js";
import {
  emptyCanvasGraph,
  type CanvasGraph,
  type CanvasNodeKind,
  type CanvasUpstreamWait,
} from "../graph/types.js";
import { validateCanvasGraph, type DagValidation } from "../graph/validate.js";
import type { WorkflowTemplateView, WorkflowVersionView } from "../model.js";
import {
  inspectWorkflowWriteClient,
  isLocalDraftVersion,
  WRITE_API_MISSING_NOTE,
  type WorkflowWriteCapabilities,
} from "../write-client.js";
import {
  D02_FREEZE_NOTE,
  EMPTY_CANVAS_NOTE,
  FORK_FROM_PUBLISHED_NOTE,
  UNPUBLISHED_RUNTIME_NOTE,
} from "./copy.js";

export const CANVAS_NEW_WORKFLOW_ID = "new";
export const CANVAS_DRAFT_VERSION_ID = "draft";

export type CanvasMode = "create" | "edit" | "readonly-frozen";
export type CanvasPersistStatus =
  "idle" | "saving" | "publishing" | "saved" | "published" | "error";

export interface CanvasDraft {
  workflowId: string | null;
  versionId: string | null;
  name: string;
  description: string;
  graph: CanvasGraph;
  dirty: boolean;
  definitionStatus?: "draft" | "published";
  versionStatus?: "draft" | "published";
  definitionRevision?: number;
  versionRevision?: number;
}

export interface CanvasSession {
  mode: CanvasMode;
  draft: CanvasDraft;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  connectFrom: string | null;
  persist: CanvasPersistStatus;
  persistError: string | null;
  validation: DagValidation;
  write: WorkflowWriteCapabilities;
  banner: string;
  connectError: string | null;
}

export type CanvasAction =
  | { type: "hydrate"; session: CanvasSession }
  | { type: "setMeta"; field: "name" | "description"; value: string }
  | { type: "addNode"; kind: CanvasNodeKind }
  | { type: "updateNode"; nodeId: string; patch: Parameters<typeof updateNode>[2] }
  | { type: "updateEdge"; edgeId: string; patch: { waitFor: CanvasUpstreamWait } }
  | {
      type: "unsetNode";
      nodeId: string;
      fields: readonly ("role" | "gate" | "joinPolicy" | "minSuccess")[];
    }
  | { type: "removeSelected" }
  | { type: "moveNode"; nodeId: string; x: number; y: number }
  | { type: "selectNode"; nodeId: string | null }
  | { type: "selectEdge"; edgeId: string | null }
  | { type: "toggleEntry"; nodeId: string }
  | { type: "startConnect"; nodeId: string }
  | { type: "completeConnect"; nodeId: string }
  | { type: "cancelConnect" }
  | { type: "saveStart" }
  | { type: "saveFailed"; error: string; workflowId?: string | null; versionId?: string | null }
  | {
      type: "saveSucceeded";
      workflowId: string;
      versionId: string;
      definitionRevision?: number;
      versionRevision?: number;
    }
  | { type: "publishStart" }
  | { type: "publishFailed"; error: string }
  | { type: "publishSucceeded" };

export function canvasCreatePath(): string {
  return `/workflows/${CANVAS_NEW_WORKFLOW_ID}`;
}

export function canvasDraftPath(
  workflowId: string,
  versionId: string = CANVAS_DRAFT_VERSION_ID,
): string {
  return `/workflows/${workflowId}/versions/${versionId}`;
}

export function workflowCatalogPath(): string {
  return "/workflows";
}

export function workflowDetailPath(workflowId: string): string {
  return `/workflows/${workflowId}`;
}

export function isCanvasAuthoringRoute(params: {
  workflowId?: string;
  versionId?: string;
}): boolean {
  return (
    params.workflowId === CANVAS_NEW_WORKFLOW_ID || params.versionId === CANVAS_DRAFT_VERSION_ID
  );
}

export function isPublishedVersionFrozen(version: WorkflowVersionView | null): boolean {
  if (!version) {
    return false;
  }
  return version.status === "published" || version.immutable === true || version.executionFrozen;
}

export function rejectInPlaceCanvasEdit(version: WorkflowVersionView | null): {
  ok: false;
  reason: string;
} {
  return {
    ok: false,
    reason: version
      ? D02_FREEZE_NOTE
      : "没有可原地编辑的未发布版本。请新建草稿或从已发布模板复制到画布。",
  };
}

function withGraph(session: CanvasSession, graph: CanvasGraph, dirty = true): CanvasSession {
  return {
    ...session,
    draft: { ...session.draft, graph, dirty },
    persist: session.persist === "published" ? "idle" : session.persist,
    persistError: session.persist === "error" ? session.persistError : null,
    validation: validateCanvasGraph(graph),
    connectError: null,
  };
}

function keepDraftId(next: string | null | undefined, current: string | null): string | null {
  if (next === undefined || next === null || next.length === 0) {
    return current;
  }
  return next;
}

export function reduceCanvasSession(session: CanvasSession, action: CanvasAction): CanvasSession {
  switch (action.type) {
    case "hydrate": {
      if (
        session.draft.dirty ||
        session.persist === "error" ||
        session.persist === "saving" ||
        session.persist === "publishing"
      ) {
        return { ...session, write: action.session.write };
      }
      return action.session;
    }
    case "setMeta": {
      if (session.mode === "readonly-frozen") {
        return session;
      }
      return {
        ...session,
        draft: { ...session.draft, [action.field]: action.value, dirty: true },
      };
    }
    case "addNode": {
      if (session.mode === "readonly-frozen") {
        return session;
      }
      return withGraph(session, addNode(session.draft.graph, action.kind));
    }
    case "updateNode": {
      if (session.mode === "readonly-frozen") {
        return session;
      }
      return withGraph(session, updateNode(session.draft.graph, action.nodeId, action.patch));
    }
    case "updateEdge": {
      if (session.mode === "readonly-frozen") {
        return session;
      }
      return withGraph(session, {
        ...session.draft.graph,
        edges: session.draft.graph.edges.map((edge) =>
          edge.id === action.edgeId ? { ...edge, waitFor: action.patch.waitFor } : edge,
        ),
      });
    }
    case "unsetNode": {
      if (session.mode === "readonly-frozen") {
        return session;
      }
      return withGraph(session, unsetNodeFields(session.draft.graph, action.nodeId, action.fields));
    }
    case "moveNode": {
      if (session.mode === "readonly-frozen") {
        return session;
      }
      return withGraph(session, moveNode(session.draft.graph, action.nodeId, action.x, action.y));
    }
    case "removeSelected": {
      if (session.mode === "readonly-frozen") {
        return session;
      }
      if (session.selectedEdgeId) {
        const next = withGraph(session, removeEdge(session.draft.graph, session.selectedEdgeId));
        return { ...next, selectedEdgeId: null };
      }
      if (session.selectedNodeId) {
        const next = withGraph(session, removeNode(session.draft.graph, session.selectedNodeId));
        return { ...next, selectedNodeId: null };
      }
      return session;
    }
    case "selectNode":
      return {
        ...session,
        selectedNodeId: action.nodeId,
        selectedEdgeId: null,
      };
    case "selectEdge":
      return {
        ...session,
        selectedEdgeId: action.edgeId,
        selectedNodeId: null,
        connectFrom: null,
      };
    case "toggleEntry": {
      if (session.mode === "readonly-frozen") {
        return session;
      }
      const isEntry = session.draft.graph.entryNodeIds.includes(action.nodeId);
      return withGraph(session, setEntryNode(session.draft.graph, action.nodeId, !isEntry));
    }
    case "startConnect": {
      if (session.mode === "readonly-frozen") {
        return session;
      }
      return {
        ...session,
        connectFrom: action.nodeId,
        selectedNodeId: action.nodeId,
        connectError: null,
      };
    }
    case "completeConnect": {
      if (session.mode === "readonly-frozen" || !session.connectFrom) {
        return session;
      }
      const result = connectNodes(session.draft.graph, session.connectFrom, action.nodeId);
      if (result.error) {
        return { ...session, connectFrom: null, connectError: result.error };
      }
      return {
        ...withGraph(session, result.graph),
        connectFrom: null,
        selectedEdgeId: result.graph.edges.at(-1)?.id ?? null,
      };
    }
    case "cancelConnect":
      return { ...session, connectFrom: null, connectError: null };
    case "saveStart": {
      if (session.mode === "readonly-frozen") {
        return {
          ...session,
          persist: "error",
          persistError: D02_FREEZE_NOTE,
        };
      }
      if (!session.write.canSaveDraft) {
        return {
          ...session,
          persist: "error",
          persistError: WRITE_API_MISSING_NOTE,
        };
      }
      return { ...session, persist: "saving", persistError: null };
    }
    case "saveFailed":
      return {
        ...session,
        persist: "error",
        persistError: action.error,
        draft: {
          ...session.draft,
          workflowId: keepDraftId(action.workflowId, session.draft.workflowId),
          versionId: keepDraftId(action.versionId, session.draft.versionId),
          dirty: true,
        },
      };
    case "saveSucceeded":
      return {
        ...session,
        persist: "saved",
        persistError: null,
        draft: {
          ...session.draft,
          workflowId: action.workflowId,
          versionId: action.versionId,
          dirty: false,
          definitionStatus: session.draft.definitionStatus ?? "draft",
          versionStatus: "draft",
          ...optionalRevision(
            "definitionRevision",
            action.definitionRevision ?? session.draft.definitionRevision,
          ),
          ...optionalRevision(
            "versionRevision",
            action.versionRevision ?? session.draft.versionRevision,
          ),
        },
      };
    case "publishStart": {
      if (session.mode === "readonly-frozen") {
        return { ...session, persist: "error", persistError: D02_FREEZE_NOTE };
      }
      if (!session.write.canPublish) {
        return { ...session, persist: "error", persistError: WRITE_API_MISSING_NOTE };
      }
      if (
        session.draft.dirty ||
        isLocalDraftVersion(session.draft.versionId) ||
        !session.draft.workflowId
      ) {
        return {
          ...session,
          persist: "error",
          persistError: "发布前必须先成功保存草稿。本地未保存内容不会被标成已发布。",
        };
      }
      if (!session.validation.ok) {
        return {
          ...session,
          persist: "error",
          persistError: session.validation.reasons[0] ?? "有限 DAG 校验未通过，不能发布。",
        };
      }
      return { ...session, persist: "publishing", persistError: null };
    }
    case "publishFailed":
      return {
        ...session,
        persist: "error",
        persistError: action.error,
        draft: { ...session.draft, dirty: session.draft.dirty },
      };
    case "publishSucceeded":
      return {
        ...session,
        persist: "published",
        persistError: null,
        mode: "readonly-frozen",
        banner: D02_FREEZE_NOTE,
        draft: { ...session.draft, dirty: false, versionStatus: "published" },
      };
  }
}

export function emptyCanvasSession(write: WorkflowWriteCapabilities): CanvasSession {
  const graph = emptyCanvasGraph();
  return {
    mode: "create",
    draft: {
      workflowId: null,
      versionId: CANVAS_DRAFT_VERSION_ID,
      name: "",
      description: "",
      graph,
      dirty: false,
    },
    selectedNodeId: null,
    selectedEdgeId: null,
    connectFrom: null,
    persist: "idle",
    persistError: null,
    validation: validateCanvasGraph(graph),
    write,
    banner: `${UNPUBLISHED_RUNTIME_NOTE} ${EMPTY_CANVAS_NOTE}`,
    connectError: null,
  };
}

export function sessionFromBlank(client: unknown): CanvasSession {
  return emptyCanvasSession(inspectWorkflowWriteClient(client));
}

export function sessionFromFork(input: {
  client: unknown;
  workflow: WorkflowTemplateView;
  source: WorkflowVersionView | null;
}): CanvasSession {
  const write = inspectWorkflowWriteClient(input.client);
  const graph = input.source ? graphFromVersion(input.source) : graphFromSteps([]);
  return {
    mode: "edit",
    draft: {
      workflowId: input.workflow.id,
      versionId: CANVAS_DRAFT_VERSION_ID,
      name: input.workflow.name,
      description: input.workflow.description,
      graph,
      dirty: true,
      definitionStatus: input.workflow.status ?? "published",
      versionStatus: "draft",
      ...optionalRevision("definitionRevision", input.workflow.stateRevision),
    },
    selectedNodeId: null,
    selectedEdgeId: null,
    connectFrom: null,
    persist: "idle",
    persistError: null,
    validation: validateCanvasGraph(graph),
    write,
    banner: `${UNPUBLISHED_RUNTIME_NOTE} ${FORK_FROM_PUBLISHED_NOTE}`,
    connectError: null,
  };
}

export function sessionFromDraftVersion(input: {
  client: unknown;
  workflow: WorkflowTemplateView;
  version: WorkflowVersionView;
}): CanvasSession {
  const write = inspectWorkflowWriteClient(input.client);
  const frozen = isPublishedVersionFrozen(input.version) && input.version.status !== "draft";
  const graph = graphFromVersion(input.version);
  return {
    mode: frozen ? "readonly-frozen" : "edit",
    draft: {
      workflowId: input.workflow.id,
      versionId: input.version.id,
      name: input.workflow.name,
      description: input.workflow.description,
      graph,
      dirty: false,
      definitionStatus: input.workflow.status ?? (frozen ? "published" : "draft"),
      versionStatus: frozen ? "published" : "draft",
      ...optionalRevision("definitionRevision", input.workflow.stateRevision),
      ...optionalRevision("versionRevision", input.version.stateRevision),
    },
    selectedNodeId: null,
    selectedEdgeId: null,
    connectFrom: null,
    persist: "idle",
    persistError: null,
    validation: validateCanvasGraph(graph),
    write,
    banner: frozen ? D02_FREEZE_NOTE : UNPUBLISHED_RUNTIME_NOTE,
    connectError: null,
  };
}

export function canvasDraftSteps(session: CanvasSession): ReturnType<typeof stepsFromGraph> {
  return stepsFromGraph(session.draft.graph);
}

export function canMutateCanvas(session: CanvasSession): boolean {
  return session.mode !== "readonly-frozen";
}

export function saveButtonState(session: CanvasSession): {
  disabled: boolean;
  reason: string | null;
} {
  if (session.mode === "readonly-frozen") {
    return { disabled: true, reason: D02_FREEZE_NOTE };
  }
  if (!session.write.canSaveDraft) {
    return { disabled: true, reason: WRITE_API_MISSING_NOTE };
  }
  if (
    (!session.draft.workflowId || session.draft.workflowId === CANVAS_NEW_WORKFLOW_ID) &&
    !session.write.available.createWorkflow
  ) {
    return {
      disabled: true,
      reason: "新建草稿需要 createWorkflow，当前 typed client 没有该方法。",
    };
  }
  if (session.persist === "saving" || session.persist === "publishing") {
    return { disabled: true, reason: "正在请求写接口…" };
  }
  return { disabled: false, reason: null };
}

export function publishButtonState(session: CanvasSession): {
  disabled: boolean;
  reason: string | null;
} {
  if (session.mode === "readonly-frozen") {
    return { disabled: true, reason: D02_FREEZE_NOTE };
  }
  if (!session.write.canPublish) {
    return { disabled: true, reason: WRITE_API_MISSING_NOTE };
  }
  if (
    session.draft.dirty ||
    isLocalDraftVersion(session.draft.versionId) ||
    !session.draft.workflowId
  ) {
    return { disabled: true, reason: "发布前必须先成功保存草稿。" };
  }
  if (!session.validation.ok) {
    return { disabled: true, reason: session.validation.reasons[0] ?? "DAG 校验未通过" };
  }
  if (session.persist === "saving" || session.persist === "publishing") {
    return { disabled: true, reason: "正在请求写接口…" };
  }
  if (session.persist === "published") {
    return { disabled: true, reason: "已发布版本不可再点发布。" };
  }
  return { disabled: false, reason: null };
}

function optionalRevision<K extends "definitionRevision" | "versionRevision">(
  key: K,
  value: number | undefined,
): Partial<Record<K, number>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<K, number>>);
}

export function persistStatusLabel(status: CanvasPersistStatus): string {
  switch (status) {
    case "idle":
      return "未保存的本地草稿";
    case "saving":
      return "正在保存草稿…";
    case "publishing":
      return "正在发布…";
    case "saved":
      return "草稿已保存（仍未发布，Runtime 不会执行）";
    case "published":
      return "已发布为不可变版本";
    case "error":
      return "写接口失败，画布内容已保留";
  }
}
