import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  asWorkflowView,
  catalogListCard,
  CATALOG_LOADING_NOTE,
  EMPTY_CATALOG_NOTE,
  FEATURE_DELIVERY_STEPS,
  FEATURE_DELIVERY_WORKFLOW,
  FEATURE_DELIVERY_WORKFLOW_ID,
  LIVE_CATALOG_NOTE,
  rejectWorkflowCanvas,
  UNAVAILABLE_CATALOG_NOTE,
  versionById,
  workflowPageModel,
} from "./model.js";
import { StructuredSteps, WorkflowsPage } from "./page.js";

describe("workflow pages", () => {
  it("keeps the published catalog read-only and exposes canvas authoring entries", () => {
    const model = workflowPageModel();
    expect(model.readonly).toBe(true);
    expect(model.canCreate).toBe(true);
    expect(model.canEditPublishedInPlace).toBe(false);
    expect(model.hasCanvasEditor).toBe(true);
    expect(model.actions).toEqual(["create", "canvas"]);
    expect(model.source).toBe("loading");
    expect(model.workflows).toEqual([]);
    expect(model.note).not.toContain("不得发明 endpoint");
    expect(rejectWorkflowCanvas().ok).toBe(false);
    expect(rejectWorkflowCanvas().reason).toContain("D02");
  });

  it("keeps live catalog rows read-only and points authors at unpublished canvas drafts", () => {
    const model = workflowPageModel({
      liveWorkflows: [{ ...FEATURE_DELIVERY_WORKFLOW, name: "Live delivery" }],
    });
    expect(model.source).toBe("live");
    expect(model.readonly).toBe(true);
    expect(model.hasCanvasEditor).toBe(true);
    expect(model.workflows[0]?.readonly).toBe(true);
    expect(model.workflows[0]?.name).toBe("Live delivery");
    expect(model.note).toBe(LIVE_CATALOG_NOTE);
    expect(model.note).not.toContain("不得发明 endpoint");
    expect(model.note).toContain("未发布图不会被");
    expect(versionById(FEATURE_DELIVERY_WORKFLOW, "0.1.0")?.steps.map((step) => step.id)).toEqual(
      FEATURE_DELIVERY_STEPS.map((step) => step.id),
    );
  });

  it("uses honest empty and unavailable copy instead of fixture fallback", () => {
    const empty = workflowPageModel({ liveWorkflows: [], status: "ok" });
    expect(empty.source).toBe("empty");
    expect(empty.workflows).toEqual([]);
    expect(empty.note).toBe(EMPTY_CATALOG_NOTE);
    expect(catalogListCard(empty.source)).toEqual({
      testId: "workflow-empty",
      text: "当前没有已发布的工作流模板。",
    });
    const unavailable = workflowPageModel({ status: "error" });
    expect(unavailable.source).toBe("unavailable");
    expect(unavailable.workflows).toEqual([]);
    expect(unavailable.note).toBe(UNAVAILABLE_CATALOG_NOTE);
    expect(catalogListCard(unavailable.source)).toEqual({
      testId: "workflow-error",
      text: UNAVAILABLE_CATALOG_NOTE,
    });
    expect(catalogListCard(unavailable.source).text).not.toBe(catalogListCard(empty.source).text);
    expect(catalogListCard("loading")).toEqual({
      testId: "workflow-loading",
      text: CATALOG_LOADING_NOTE,
    });
  });

  it("maps catalog DTOs without inventing fixture steps", () => {
    const view = asWorkflowView({
      id: FEATURE_DELIVERY_WORKFLOW_ID,
      name: "Feature delivery",
      description: "published template",
      activeVersionId: "0.1.0",
      versions: [
        {
          id: "0.1.0",
          version: "0.1.0",
          status: "published",
          entry: "planning",
          steps: FEATURE_DELIVERY_STEPS,
        },
      ],
    });
    expect(view?.readonly).toBe(true);
    expect(view?.versions[0]?.steps).toHaveLength(5);
    expect(view?.versions[0]?.executionFrozen).toBe(true);
    expect(asWorkflowView({ id: "wf_empty", versions: [] })?.versions).toEqual([]);
  });

  it("renders the list with a new-canvas entry and no fake publish success", () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowsPage, {
        params: {},
        path: "/workflows",
        navigate: () => undefined,
      }),
    );
    expect(html).toContain("工作流");
    expect(html).toContain("workflow-new-canvas");
    expect(html).toContain("项目制循环");
    expect(html).toContain("workflow-loading");
    expect(html).toContain("对话生成");
    expect(html).toContain("workflow-authoring-chat-disabled");
    expect(html).toContain("用对话生成");
    expect(html).not.toContain("workflow-empty");
    expect(html).not.toContain("不得发明 endpoint");
    expect(html).not.toContain("可视化编辑器已可用且已接通写接口");
    expect(html).not.toContain("已发布为不可变版本");
    expect(html).not.toContain("会话已接通");
  });

  it("opens the canvas authoring route for /workflows/new", () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowsPage, {
        params: { workflowId: "new" },
        path: "/workflows/new",
        navigate: () => undefined,
      }),
    );
    expect(html).toContain("workflow-canvas-page");
    expect(html).toContain("未发布，Runtime 不会执行此图");
    expect(html).toContain("保存草稿");
    expect(html).toContain("发布");
  });

  it("renders version detail as structured steps for published graphs", () => {
    const html = renderToStaticMarkup(
      createElement(StructuredSteps, {
        version: FEATURE_DELIVERY_WORKFLOW.versions[0]!,
      }),
    );
    expect(html).toContain("结构化步骤");
    expect(html).toContain("规划");
    expect(html).toContain("整合");
    expect(html).toContain("验收");
    expect(html).toContain("gate plan");
    expect(html).toContain("workflow-step-planning");
    expect(html).toContain("Worker planner");
    expect(html).not.toContain("拖拽节点");
  });
});
