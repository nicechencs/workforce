import { describe, expect, it } from "vitest";

import {
  createShellRegistry,
  loadFeatureModules,
  shouldRenderFeaturePage,
} from "../src/renderer/app/feature-modules.js";

describe("feature glob registry", () => {
  it("treats missing feature modules as placeholders", () => {
    const registry = createShellRegistry({});
    const resolved = registry.resolve("/projects");
    expect(loadFeatureModules({})).toEqual([]);
    expect(resolved?.featureRegistered).toBe(false);
    expect(shouldRenderFeaturePage(resolved, registry.getFeatureModule("projects")?.Page)).toBe(
      false,
    );
  });

  it("registers glob-loaded feature pages without stub folders", () => {
    const registry = createShellRegistry({
      "../features/projects/index.tsx": {
        feature: {
          slot: "projects",
          Page: () => "projects-page",
        },
      },
    });
    const resolved = registry.resolve("/projects/p1");
    expect(resolved?.featureRegistered).toBe(true);
    expect(resolved?.params.projectId).toBe("p1");
    expect(shouldRenderFeaturePage(resolved, registry.getFeatureModule("projects")?.Page)).toBe(
      true,
    );
    expect(registry.resolve("/runs")?.featureRegistered).toBe(false);
  });
});
