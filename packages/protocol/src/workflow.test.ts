import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  isExecutableWorkflowVersion,
  parseWorkflow,
  parseWorkflowPage,
  parseWorkflowVersion,
  workflowSchema,
} from "./workflow.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/protocols/v0.1/fixtures",
);

describe("workflow catalog DTO", () => {
  it("accepts the published feature-delivery template fixture", () => {
    const raw: unknown = JSON.parse(
      readFileSync(resolve(fixtures, "workflow.feature-delivery.json"), "utf8"),
    );
    const workflow = parseWorkflow(raw);
    expect(workflow.id).toBe("software-development-team.feature-delivery");
    expect(workflow.status).toBe("published");
    expect(workflow.versions).toHaveLength(1);
    expect(workflow.versions[0]?.immutable).toBe(true);
    expect(workflow.versions[0]?.steps.map((step) => step.id)).toEqual([
      "planning",
      "implementation",
      "integration",
      "review",
      "acceptance",
    ]);
    expect(parseWorkflowVersion(workflow.versions[0])).toEqual(workflow.versions[0]);
  });

  it("accepts an empty catalog page", () => {
    const page = parseWorkflowPage({
      items: [],
      page: { nextCursor: null, hasMore: false },
    });
    expect(page.items).toEqual([]);
    expect(page.page.hasMore).toBe(false);
  });

  it("rejects canvas/editor or executable-runtime fields", () => {
    expect(() =>
      workflowSchema.parse({
        id: "wf_1",
        name: "Edited",
        description: "",
        protocolVersion: "0.1",
        status: "published",
        activeVersionId: "0.1.0",
        versions: [],
        canvas: true,
      }),
    ).toThrow();
    expect(() =>
      workflowSchema.parse({
        id: "wf_1",
        name: "Edited",
        description: "",
        protocolVersion: "0.1",
        status: "draft",
        activeVersionId: "0.1.0",
        versions: [],
        executionMode: "direct",
      }),
    ).toThrow();
  });

  it("accepts a draft definition with an unpublished graph", () => {
    const workflow = parseWorkflow({
      id: "wfd_1",
      name: "Custom DAG",
      description: "",
      protocolVersion: "0.1",
      status: "draft",
      stateRevision: 1,
      definitionRevision: 1,
      activeVersionId: "wfv_1",
      versions: [
        {
          id: "wfv_1",
          workflowId: "wfd_1",
          version: "1",
          status: "draft",
          immutable: false,
          stateRevision: 1,
          entry: "plan",
          nodes: [{ id: "plan", kind: "task", role: "planner", title: "Plan" }],
          edges: [],
          steps: [{ id: "plan", kind: "task", title: "Plan", notes: [] }],
        },
      ],
    });
    expect(workflow.status).toBe("draft");
    expect(workflow.versions[0]?.immutable).toBe(false);
    expect(workflow.versions[0]?.nodes?.[0]?.kind).toBe("task");
    expect(isExecutableWorkflowVersion(workflow.versions[0]!)).toBe(false);
  });
});
