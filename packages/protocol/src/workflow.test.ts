import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
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
      }),
    ).toThrow();
  });
});
