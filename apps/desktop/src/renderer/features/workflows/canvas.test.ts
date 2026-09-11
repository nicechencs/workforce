import { createDesktopClient, type CommandOptions } from "@workforce/desktop-client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { loadCanvasSession, WorkflowCanvasPage } from "./canvas/page.js";
import {
  CANVAS_DRAFT_VERSION_ID,
  canvasCreatePath,
  canvasDraftPath,
  emptyCanvasSession,
  isPublishedVersionFrozen,
  persistStatusLabel,
  publishButtonState,
  reduceCanvasSession,
  rejectInPlaceCanvasEdit,
  saveButtonState,
  sessionFromBlank,
  sessionFromDraftVersion,
  sessionFromFork,
} from "./canvas/model.js";
import { addNode, connectNodes } from "./graph/operations.js";
import { graphFromSteps, stepsFromGraph, toProtocolGraph } from "./graph/from-catalog.js";
import { emptyCanvasGraph, toGraphPayload } from "./graph/types.js";
import { validateCanvasGraph } from "./graph/validate.js";
import {
  FEATURE_DELIVERY_STEPS,
  FEATURE_DELIVERY_WORKFLOW,
  FEATURE_DELIVERY_WORKFLOW_ID,
} from "./model.js";
import {
  inspectWorkflowWriteClient,
  persistWorkflowDraft,
  publishWorkflowDraft,
  WRITE_API_MISSING_NOTE,
  WRITE_API_READY_NOTE,
  type WorkflowWriteClient,
  type WorkflowWriteResult,
} from "./write-client.js";

function writeCaps(overrides: Partial<ReturnType<typeof inspectWorkflowWriteClient>> = {}) {
  const base = inspectWorkflowWriteClient({});
  return { ...base, ...overrides, available: { ...base.available, ...overrides.available } };
}

describe("canvas DAG validation", () => {
  it("rejects empty, self-loop, missing refs, and cycles", () => {
    expect(validateCanvasGraph(emptyCanvasGraph()).ok).toBe(false);
    const one = addNode(emptyCanvasGraph(), "task", "a");
    const loop = connectNodes(one, "a", "a");
    expect(loop.error).toContain("自环");
    const two = addNode(one, "task", "b");
    const ab = connectNodes(two, "a", "b").graph;
    const cyclic = connectNodes(ab, "b", "a").graph;
    const cycleResult = validateCanvasGraph(cyclic);
    expect(cycleResult.ok).toBe(false);
    if (!cycleResult.ok) {
      expect(cycleResult.reasons.some((reason) => reason.includes("循环"))).toBe(true);
    }
    const dangling = {
      ...two,
      edges: [{ id: "e_x", from: "a", to: "missing" }],
    };
    const danglingResult = validateCanvasGraph(dangling);
    expect(danglingResult.ok).toBe(false);
    if (!danglingResult.ok) {
      expect(danglingResult.reasons.some((reason) => reason.includes("不存在"))).toBe(true);
    }
  });

  it("accepts a linear feature-delivery fork", () => {
    const graph = graphFromSteps(FEATURE_DELIVERY_STEPS, "planning");
    const result = validateCanvasGraph(graph);
    expect(result.ok).toBe(true);
    expect(stepsFromGraph(graph).map((step) => step.id)).toEqual(
      FEATURE_DELIVERY_STEPS.map((step) => step.id),
    );
  });
});

describe("write client stubs", () => {
  it("disables save and publish when DesktopClient has no write methods", () => {
    const caps = inspectWorkflowWriteClient({
      listWorkflows: async () => ({ items: [], page: { nextCursor: null, hasMore: false } }),
    });
    expect(caps.canSaveDraft).toBe(false);
    expect(caps.canPublish).toBe(false);
    expect(caps.missing).toContain("publishWorkflowVersion");
    expect(caps.note).toBe(WRITE_API_MISSING_NOTE);
    const session = emptyCanvasSession(caps);
    expect(saveButtonState(session).disabled).toBe(true);
    expect(publishButtonState(session).disabled).toBe(true);
    expect(saveButtonState(session).reason).toContain("缺少工作流写方法");
  });

  it("enables save on the typed DesktopClient write methods", () => {
    const client = createDesktopClient({
      transport: {
        async request() {
          return { status: 503, headers: {}, body: {} };
        },
      },
    });
    const caps = inspectWorkflowWriteClient(client);
    expect(caps.canSaveDraft).toBe(true);
    expect(caps.canPublish).toBe(true);
    expect(caps.missing).toEqual([]);
    expect(caps.note).toBe(WRITE_API_READY_NOTE);
    const session = sessionFromBlank(client);
    expect(saveButtonState(session).disabled).toBe(false);
    expect(publishButtonState(session).disabled).toBe(true);
    expect(publishButtonState(session).reason).toContain("先成功保存草稿");
  });

  it("never marks publish success when the method is missing", async () => {
    const result = await publishWorkflowDraft({}, { workflowId: "wf_1", versionId: "v1" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(WRITE_API_MISSING_NOTE);
    }
    const persisted = await persistWorkflowDraft(
      {},
      {
        workflowId: null,
        versionId: CANVAS_DRAFT_VERSION_ID,
        name: "Demo",
        description: "",
        graph: toGraphPayload(emptyCanvasGraph()),
        steps: [],
      },
    );
    expect(persisted.ok).toBe(false);
  });

  it("POSTs protocol nodes/edges and keeps the draft when publish throws", async () => {
    const calls: Array<{ name: string; body?: unknown; ifMatch?: CommandOptions["ifMatch"] }> = [];
    const client: WorkflowWriteClient = {
      createWorkflow: async (input, options) => {
        calls.push({ name: `create:${input.name}`, body: input, ifMatch: options.ifMatch });
        return { id: "wf_created", stateRevision: 1 };
      },
      createWorkflowVersion: async (id, input, options) => {
        calls.push({ name: `version:${id}`, body: input, ifMatch: options.ifMatch });
        return { id: "ver_1", stateRevision: 1 };
      },
      publishWorkflowVersion: async (_id, _versionId, options) => {
        calls.push({ name: "publish", ifMatch: options.ifMatch });
        throw new Error("publish rejected: invalid DAG");
      },
    };
    const graph = graphFromSteps(FEATURE_DELIVERY_STEPS, "planning");
    const saved = await persistWorkflowDraft(client, {
      workflowId: null,
      versionId: "draft",
      name: "Demo",
      description: "keep me",
      graph: toGraphPayload(graph),
      steps: FEATURE_DELIVERY_STEPS,
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.versionId).toBe("ver_1");
      expect(saved.revisions.versionRevision).toBe(1);
      const published = await publishWorkflowDraft(client, {
        workflowId: saved.workflowId,
        versionId: saved.versionId,
        versionRevision: saved.revisions.versionRevision,
      });
      expect(published.ok).toBe(false);
      if (!published.ok) {
        expect(published.error).toContain("invalid DAG");
      }
    }
    expect(calls.map((item) => item.name)).toEqual([
      "create:Demo",
      "version:wf_created",
      "publish",
    ]);
    const versionBody = calls[1]?.body as Record<string, unknown>;
    expect(versionBody).toMatchObject(toProtocolGraph(graph));
    expect(versionBody).not.toHaveProperty("graph");
    expect(versionBody).not.toHaveProperty("status");
    expect(versionBody.nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "integration", kind: "task" })]),
    );
    expect(calls[1]?.ifMatch).toBe(1);
    expect(calls[2]?.ifMatch).toBe(1);
  });

  it("does not treat a non-published status as success", async () => {
    const client: WorkflowWriteClient = {
      publishWorkflowVersion: async (): Promise<WorkflowWriteResult> => ({
        id: "wf_1",
        versionId: "v1",
        status: "draft",
      }),
    };
    const result = await publishWorkflowDraft(client, {
      workflowId: "wf_1",
      versionId: "v1",
      versionRevision: 1,
    });
    expect(result.ok).toBe(false);
  });

  it("refuses publish without a saved revision instead of faking success", async () => {
    const client: WorkflowWriteClient = {
      publishWorkflowVersion: async () => ({ id: "v1", status: "published" }),
    };
    const result = await publishWorkflowDraft(client, { workflowId: "wf_1", versionId: "v1" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("stateRevision");
    }
  });
});

describe("canvas session reducer", () => {
  it("preserves nodes after save and publish failures", () => {
    let session = sessionFromBlank({});
    session = reduceCanvasSession(session, { type: "addNode", kind: "task" });
    session = reduceCanvasSession(session, { type: "addNode", kind: "approval" });
    const nodeIds = session.draft.graph.nodes.map((node) => node.id);
    session = reduceCanvasSession(session, { type: "saveStart" });
    expect(session.persist).toBe("error");
    session = reduceCanvasSession(session, { type: "saveFailed", error: "no write API" });
    expect(session.draft.graph.nodes.map((node) => node.id)).toEqual(nodeIds);
    expect(session.persist).toBe("error");
    expect(persistStatusLabel(session.persist)).toContain("保留");
    session = reduceCanvasSession(session, { type: "publishStart" });
    session = reduceCanvasSession(session, { type: "publishFailed", error: "still no write API" });
    expect(session.draft.graph.nodes.map((node) => node.id)).toEqual(nodeIds);
    expect(session.persist).not.toBe("published");
  });

  it("only sets published after an explicit publishSucceeded", () => {
    const ready = writeCaps({
      canSaveDraft: true,
      canPublish: true,
    });
    let session = emptyCanvasSession(ready);
    session = reduceCanvasSession(session, { type: "setMeta", field: "name", value: "Ship" });
    session = reduceCanvasSession(session, { type: "addNode", kind: "task" });
    session = reduceCanvasSession(session, {
      type: "saveSucceeded",
      workflowId: "wf_1",
      versionId: "ver_1",
      definitionRevision: 2,
      versionRevision: 1,
    });
    expect(session.draft.versionRevision).toBe(1);
    expect(session.persist).toBe("saved");
    expect(session.persist).not.toBe("published");
    session = reduceCanvasSession(session, { type: "publishStart" });
    expect(session.persist).toBe("publishing");
    session = reduceCanvasSession(session, { type: "publishFailed", error: "server 422" });
    expect(session.draft.name).toBe("Ship");
    expect(session.draft.graph.nodes).toHaveLength(1);
    session = reduceCanvasSession(session, { type: "publishSucceeded" });
    expect(session.persist).toBe("published");
    expect(session.mode).toBe("readonly-frozen");
  });

  it("freezes published and execution-bound versions (D02)", () => {
    const published = FEATURE_DELIVERY_WORKFLOW.versions[0];
    expect(published).toBeTruthy();
    if (!published) {
      return;
    }
    expect(isPublishedVersionFrozen(published)).toBe(true);
    expect(rejectInPlaceCanvasEdit(published).ok).toBe(false);
    expect(rejectInPlaceCanvasEdit(published).reason).toContain("冻结");
    const frozen = sessionFromDraftVersion({
      client: {},
      workflow: FEATURE_DELIVERY_WORKFLOW,
      version: published,
    });
    expect(frozen.mode).toBe("readonly-frozen");
    const afterAdd = reduceCanvasSession(frozen, { type: "addNode", kind: "task" });
    expect(afterAdd.draft.graph.nodes).toHaveLength(frozen.draft.graph.nodes.length);
  });

  it("forks a published template into a dirty local draft without mutating the source", () => {
    const forked = sessionFromFork({
      client: {},
      workflow: FEATURE_DELIVERY_WORKFLOW,
      source: FEATURE_DELIVERY_WORKFLOW.versions[0] ?? null,
    });
    expect(forked.mode).toBe("edit");
    expect(forked.draft.versionId).toBe(CANVAS_DRAFT_VERSION_ID);
    expect(forked.draft.dirty).toBe(true);
    expect(forked.draft.workflowId).toBe(FEATURE_DELIVERY_WORKFLOW_ID);
    expect(FEATURE_DELIVERY_WORKFLOW.versions[0]?.status).toBe("published");
    expect(forked.banner).toContain("Runtime 不会执行");
  });
});

describe("canvas routes", () => {
  it("uses reserved new/draft paths that already exist on the workflows slot", () => {
    expect(canvasCreatePath()).toBe("/workflows/new");
    expect(canvasDraftPath(FEATURE_DELIVERY_WORKFLOW_ID)).toBe(
      `/workflows/${FEATURE_DELIVERY_WORKFLOW_ID}/versions/draft`,
    );
  });
});

describe("canvas page render", () => {
  it("renders authoring chrome with save enabled on the typed write client", () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowCanvasPage, {
        workflowId: "new",
        navigate: () => undefined,
      }),
    );
    expect(html).toContain("workflow-canvas-page");
    expect(html).toContain("未发布，Runtime 不会执行此图");
    expect(html).toContain("项目制循环");
    expect(html).toContain("workflow-canvas-save");
    expect(html).toContain(WRITE_API_READY_NOTE);
    expect(html).not.toContain("写接口尚未挂到 typed client");
    expect(html).not.toContain("缺少工作流写方法");
    expect(html).not.toContain("已发布为不可变版本");
    expect(html).toContain("发布前必须先成功保存草稿");
  });
});

describe("canvas reload after save", () => {
  it("restores the same draft name and graph from getWorkflow", async () => {
    const graph = addNode(emptyCanvasGraph(), "task", "plan");
    const workflow = {
      id: "wfd_saved",
      name: "Saved draft",
      description: "",
      protocolVersion: "0.1" as const,
      status: "draft" as const,
      stateRevision: 2,
      versions: [
        {
          id: "wfv_saved",
          workflowId: "wfd_saved",
          version: "1",
          status: "draft" as const,
          immutable: false,
          entry: "plan",
          stateRevision: 1,
          nodes: [{ id: "plan", kind: "task" as const, title: "任务" }],
          edges: [],
        },
      ],
    };
    const session = await loadCanvasSession(
      {
        getWorkflow: async () => workflow,
        getWorkflowVersion: async () => workflow.versions[0]!,
      },
      "wfd_saved",
      "wfv_saved",
    );
    expect(session.draft.name).toBe("Saved draft");
    expect(session.draft.versionId).toBe("wfv_saved");
    expect(session.draft.graph.nodes.map((node) => node.id)).toEqual(["plan"]);
    expect(session.draft.definitionRevision).toBe(2);
    expect(session.draft.versionRevision).toBe(1);
    expect(session.mode).toBe("edit");
  });
});
