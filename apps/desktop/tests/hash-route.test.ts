import { describe, expect, it } from "vitest";

import { parseHashPath, pathToHash, slotForHash } from "../src/renderer/app/hash-router.js";
import { createRouteRegistry } from "../src/renderer/routes/index.js";

describe("hash route to slot", () => {
  it("normalizes location.hash onto catalog paths", () => {
    expect(parseHashPath("")).toBe("/");
    expect(parseHashPath("#")).toBe("/");
    expect(parseHashPath("#/")).toBe("/");
    expect(parseHashPath("#/projects")).toBe("/projects");
    expect(parseHashPath("#projects/p1")).toBe("/projects/p1");
    expect(pathToHash("/runs/r1")).toBe("#/runs/r1");
  });

  it("maps hash routes onto feature slots without changing catalog paths", () => {
    const registry = createRouteRegistry();
    expect(slotForHash("#/", registry)).toBe("dashboard");
    expect(slotForHash("#/projects", registry)).toBe("projects");
    expect(slotForHash("#/projects/p1", registry)).toBe("projects");
    expect(slotForHash("#/projects/p1/tasks/t1", registry)).toBe("tasks");
    expect(slotForHash("#/runs/r1", registry)).toBe("runs");
    expect(slotForHash("#/workflows", registry)).toBe("workflows");
    expect(slotForHash("#/workflows/wf_1/versions/0.1.0", registry)).toBe("workflows");
    expect(slotForHash("#/settings", registry)).toBe("settings");
  });
});
