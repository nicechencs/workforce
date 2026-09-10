import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  FEATURE_DELIVERY_STEPS,
  FEATURE_DELIVERY_WORKFLOW,
  FEATURE_DELIVERY_WORKFLOW_ID,
  rejectWorkflowCanvas,
  versionById,
  workflowPageModel,
} from "./model.js";
import { StructuredSteps, WorkflowsPage } from "./page.js";

describe("workflow pages", () => {
  it("is read-only template/version/steps and does not expose a canvas editor", () => {
    const model = workflowPageModel();
    expect(model.readonly).toBe(true);
    expect(model.canCreate).toBe(false);
    expect(model.canEdit).toBe(false);
    expect(model.hasCanvasEditor).toBe(false);
    expect(model.actions).toEqual([]);
    expect(model.source).toBe("preset");
    expect(model.note).toContain("GET /workflows");
    expect(model.note).toContain("不是可视化编辑器");
    expect(model.workflows).toEqual([FEATURE_DELIVERY_WORKFLOW]);
    expect(FEATURE_DELIVERY_WORKFLOW.id).toBe(FEATURE_DELIVERY_WORKFLOW_ID);
    expect(versionById(FEATURE_DELIVERY_WORKFLOW, "0.1.0")?.steps.map((step) => step.id)).toEqual(
      FEATURE_DELIVERY_STEPS.map((step) => step.id),
    );
    expect(rejectWorkflowCanvas().ok).toBe(false);
    expect(rejectWorkflowCanvas().reason).toContain("结构化步骤");
  });

  it("keeps live catalog rows read-only when GET /workflows exists", () => {
    const model = workflowPageModel({
      liveWorkflows: [{ ...FEATURE_DELIVERY_WORKFLOW, name: "Live delivery" }],
    });
    expect(model.source).toBe("live");
    expect(model.readonly).toBe(true);
    expect(model.hasCanvasEditor).toBe(false);
    expect(model.workflows[0]?.readonly).toBe(true);
    expect(model.workflows[0]?.name).toBe("Live delivery");
  });

  it("renders the fixture list without claiming a complete Runtime", () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowsPage, {
        params: {},
        path: "/workflows",
        navigate: () => undefined,
      }),
    );
    expect(html).toContain("工作流");
    expect(html).toContain("Feature delivery");
    expect(html).toContain(FEATURE_DELIVERY_WORKFLOW_ID);
    expect(html).toContain("没有画布编辑器");
    expect(html).not.toContain("可视化编辑器已可用");
    expect(html.toLowerCase()).not.toContain("canvas");
  });

  it("renders version detail as structured steps, not a graph editor", () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowsPage, {
        params: {
          workflowId: FEATURE_DELIVERY_WORKFLOW_ID,
          versionId: "0.1.0",
        },
        path: `/workflows/${FEATURE_DELIVERY_WORKFLOW_ID}/versions/0.1.0`,
        navigate: () => undefined,
      }),
    );
    expect(html).toContain("Feature delivery");
    expect(html).toContain("结构化步骤");
    expect(html).toContain("规划");
    expect(html).toContain("整合");
    expect(html).toContain("验收");
    expect(html).toContain("gate plan");
    expect(html).toContain("不可变");
    expect(html).toContain("不提供可视化 Workflow 编辑器");
    expect(html).not.toContain("拖拽节点");

    const steps = renderToStaticMarkup(
      createElement(StructuredSteps, {
        version: FEATURE_DELIVERY_WORKFLOW.versions[0]!,
      }),
    );
    expect(steps).toContain("workflow-step-planning");
    expect(steps).toContain("Worker planner");
  });
});
