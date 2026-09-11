import { describe, expect, it } from "vitest";

import { assertSafePath, paths } from "./paths.js";

describe("desktop-client paths", () => {
  it("never puts secrets in URLs", () => {
    expect(paths.artifactVersionContent("art_1", "arv_1")).toBe(
      "/api/v1/artifacts/art_1/versions/arv_1/content",
    );
    expect(paths.eventsStream({ projectId: "prj_1", cursor: "1:abc" })).toBe(
      "/api/v1/events/stream?projectId=prj_1&cursor=1%3Aabc",
    );
    expect(() => assertSafePath("/api/v1/runs/run_1?token=secret")).toThrow(/Secrets/);
    expect(() => assertSafePath("http://127.0.0.1/api/v1/health")).toThrow(/root-relative/);
  });

  it("builds command paths with colon actions", () => {
    expect(paths.projectStartPlanning("prj_1")).toBe("/api/v1/projects/prj_1:start-planning");
    expect(paths.runCancel("run_1")).toBe("/api/v1/runs/run_1:cancel");
    expect(paths.approvalRequestChanges("apr_1")).toBe("/api/v1/approvals/apr_1:request-changes");
    expect(paths.teams()).toBe("/api/v1/teams");
    expect(paths.team("tm_custom")).toBe("/api/v1/teams/tm_custom");
    expect(paths.teamVersions("tm_custom")).toBe("/api/v1/teams/tm_custom/versions");
    expect(paths.teamVersion("tm_custom", "tmv_1")).toBe("/api/v1/teams/tm_custom/versions/tmv_1");
    expect(paths.teamVersionPublish("tm_custom", "tmv_1")).toBe(
      "/api/v1/teams/tm_custom/versions/tmv_1:publish",
    );
    expect(paths.workflows()).toBe("/api/v1/workflows");
    expect(paths.workflow("software-development-team.feature-delivery")).toBe(
      "/api/v1/workflows/software-development-team.feature-delivery",
    );
    expect(paths.workflowVersion("software-development-team.feature-delivery", "0.1.0")).toBe(
      "/api/v1/workflows/software-development-team.feature-delivery/versions/0.1.0",
    );
    expect(paths.workflowVersionPublish("wfd_1", "wfv_1")).toBe(
      "/api/v1/workflows/wfd_1/versions/wfv_1:publish",
    );
    expect(paths.teamVersion("tm_1", "tmv_1")).toBe("/api/v1/teams/tm_1/versions/tmv_1");
    expect(paths.teamVersionPublish("tm_1", "tmv_1")).toBe(
      "/api/v1/teams/tm_1/versions/tmv_1:publish",
    );
    expect(paths.runtimeCapabilities("mock")).toBe("/api/v1/runtimes/mock/capabilities");
    expect(paths.projectBudget("prj_1")).toBe("/api/v1/projects/prj_1/budget");
    expect(paths.projectWorkspaces("prj_1")).toBe("/api/v1/projects/prj_1/workspaces");
  });
});
