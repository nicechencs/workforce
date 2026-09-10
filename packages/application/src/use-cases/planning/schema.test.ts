import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { MOCK_PLAN_DOCUMENT, mockPlanFixture } from "./mock-plan.js";
import { parsePlanArtifact } from "./schema.js";
import type { PlanArtifact } from "./types.js";

const templateRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../templates/software-development-team",
);

function clonePlan(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(MOCK_PLAN_DOCUMENT)) as Record<string, unknown>;
}

describe("plan artifact schema", () => {
  it("accepts the fixed mock plan fixture", () => {
    const parsed = parsePlanArtifact(MOCK_PLAN_DOCUMENT);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const plan = parsed.plan;
    expect(plan.nodes.map((node) => node.id)).toEqual([
      "dev_alpha",
      "dev_bravo",
      "review_integration",
      "approve_delivery",
    ]);
    expect(
      plan.nodes.filter((node) => node.kind === "task" && node.role === "developer"),
    ).toHaveLength(2);
    expect(plan.nodes.some((node) => node.kind === "task" && node.role === "reviewer")).toBe(true);
    expect(plan.nodes.some((node) => node.kind === "approval" && node.gate === "artifact")).toBe(
      true,
    );
    expect(plan.edges.every((edge) => edge.onUpstream === "outputs_ready")).toBe(true);
    expect(plan.runtime.adapterId).toBe("mock");
    expect(plan.integration.strategy).toBe("stable_node_id_order");
    expect(mockPlanFixture().workflowId).toBe(plan.workflowId);
  });

  it("matches the template JSON fixture", () => {
    const raw: unknown = JSON.parse(
      readFileSync(resolve(templateRoot, "fixtures/mock-plan.json"), "utf8"),
    );
    const fromFile = parsePlanArtifact(raw);
    const fromTs = parsePlanArtifact(MOCK_PLAN_DOCUMENT);
    expect(fromFile.ok).toBe(true);
    expect(fromTs.ok).toBe(true);
    if (fromFile.ok && fromTs.ok) {
      expect(fromFile.plan).toEqual(fromTs.plan);
    }
  });

  it("rejects unbounded task counts", () => {
    const body = clonePlan();
    body.bounds = { maxDepth: 4, maxTasks: 2, maxAttempts: 3, maxReworkCycles: 2 };
    const parsed = parsePlanArtifact(body);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe("validation_failed");
      expect(parsed.error.message).toMatch(/maxTasks/);
    }
  });

  it("rejects plans over the hard task cap", () => {
    const body = clonePlan();
    body.bounds = { maxDepth: 4, maxTasks: 99, maxAttempts: 3, maxReworkCycles: 2 };
    const parsed = parsePlanArtifact(body);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.message).toMatch(/hard cap/);
    }
  });

  it("rejects a cycle", () => {
    const body = clonePlan();
    const edges = body.edges as unknown[];
    edges.push({
      id: "e_cycle",
      from: "review_integration",
      to: "dev_alpha",
      onUpstream: "outputs_ready",
    });
    const parsed = parsePlanArtifact(body);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.message).toMatch(/cycle|must not depend/u);
    }
  });

  it("rejects a developer that waits on the reviewer", () => {
    const body = clonePlan();
    const alpha = (body.nodes as Record<string, unknown>[])[0];
    if (!alpha) {
      throw new Error("expected mock plan to include a developer node");
    }
    (body.nodes as unknown[]).push({
      ...alpha,
      id: "dev_charlie",
      title: "Implement slice Charlie",
      objective: "Follow-up slice that must not wait on review.",
    });
    (body.edges as unknown[]).push({
      id: "e_review_charlie",
      from: "review_integration",
      to: "dev_charlie",
      onUpstream: "completed",
    });
    const parsed = parsePlanArtifact(body);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.message).toMatch(/must not depend on reviewer/);
    }
  });

  it("rejects reviewer edges that wait for developer completed", () => {
    const body = clonePlan();
    const edges = (body.edges as { id: string; onUpstream: string }[]).map((edge) =>
      edge.id === "e_alpha_review" ? { ...edge, onUpstream: "completed" } : edge,
    );
    body.edges = edges;
    const parsed = parsePlanArtifact(body);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.message).toMatch(/outputs_ready/);
    }
  });

  it("rejects a plan without human artifact approval", () => {
    const body = clonePlan();
    body.nodes = (body.nodes as { kind: string }[]).filter((node) => node.kind !== "approval");
    body.edges = (body.edges as { to: string }[]).filter((edge) => edge.to !== "approve_delivery");
    const parsed = parsePlanArtifact(body);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.message).toMatch(/artifact approval/);
    }
  });

  it("is a valid PlanArtifact type after parse", () => {
    const plan: PlanArtifact = mockPlanFixture();
    expect(plan.protocol).toBe("workforce.plan");
    expect(plan.integration.contributorNodeIds).toEqual(["dev_alpha", "dev_bravo"]);
  });
});
