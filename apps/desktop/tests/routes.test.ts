import { describe, expect, it } from "vitest";

import { createRouteRegistry, SHELL_ROUTES } from "../src/renderer/routes/index.js";

describe("shell route registry", () => {
  it("registers P0 placeholder routes for T12/T13 feature slots", () => {
    const slots = new Set(SHELL_ROUTES.map((route) => route.slot));
    expect(slots.has("dashboard")).toBe(true);
    expect(slots.has("projects")).toBe(true);
    expect(slots.has("tasks")).toBe(true);
    expect(slots.has("teams")).toBe(true);
    expect(slots.has("runs")).toBe(true);
    expect(slots.has("workflows")).toBe(true);
    expect(slots.has("approvals")).toBe(true);
    expect(slots.has("nodes")).toBe(true);
    expect(slots.has("settings")).toBe(true);
  });

  it("resolves workflow list, detail, and version paths onto the workflows slot", () => {
    const registry = createRouteRegistry();
    expect(registry.resolve("/workflows")?.route.slot).toBe("workflows");
    expect(
      registry.resolve("/workflows/software-development-team.feature-delivery")?.params,
    ).toEqual({ workflowId: "software-development-team.feature-delivery" });
    expect(
      registry.resolve("/workflows/software-development-team.feature-delivery/versions/0.1.0")
        ?.params,
    ).toEqual({
      workflowId: "software-development-team.feature-delivery",
      versionId: "0.1.0",
    });
  });

  it("lets feature modules register without editing the catalog", () => {
    const registry = createRouteRegistry();
    expect(registry.resolve("/projects/p1")?.featureRegistered).toBe(false);
    registry.registerFeatureModule({ slot: "projects" });
    const resolved = registry.resolve("/projects/p1");
    expect(resolved?.route.slot).toBe("projects");
    expect(resolved?.params.projectId).toBe("p1");
    expect(resolved?.featureRegistered).toBe(true);
  });
});
