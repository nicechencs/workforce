import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ApprovalDto, ProjectDto, RunDto } from "@workforce/desktop-client";

import { DashboardView } from "./page.js";
import { activeProjects, activeRuns, pendingApprovals } from "./model.js";

function run(overrides: Partial<RunDto> = {}): RunDto {
  return {
    id: "run_1",
    taskId: "task_1",
    projectId: "prj_1",
    status: "running",
    stateRevision: 1,
    definitionRevision: 1,
    generation: 1,
    attempt: 1,
    protocolVersion: "0.1",
    cancelRequested: false,
    usage: { costMinor: 0, currency: "USD", kind: "unknown" },
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("dashboard workbench", () => {
  it("lists pending approvals, active runs, active projects, and a 新建项目 CTA", () => {
    const approvals: ApprovalDto[] = [
      {
        id: "apr_1",
        projectId: "prj_1",
        gate: "plan",
        status: "pending",
        stateRevision: 1,
        actionDigest: "sha256:plan",
        resource: "av_plan",
        requestedAt: "2026-09-10T00:00:00.000Z",
      },
    ];
    const projects: ProjectDto[] = [
      {
        id: "prj_1",
        organizationId: "org_local",
        name: "Workforce",
        objective: "ship",
        status: "running",
        stateRevision: 2,
        protocolVersion: "0.1",
        cancelRequested: false,
        createdAt: "2026-09-10T00:00:00.000Z",
        updatedAt: "2026-09-10T00:00:00.000Z",
      },
    ];
    expect(pendingApprovals(approvals)).toHaveLength(1);
    expect(activeRuns([run(), run({ id: "run_2", status: "succeeded" })])).toHaveLength(1);
    expect(activeProjects(projects)).toHaveLength(1);

    const navigated: string[] = [];
    const html = renderToStaticMarkup(
      createElement(DashboardView, {
        approvals,
        runs: [run({ usage: { costMinor: 0, currency: "USD", kind: "unknown" } })],
        projects,
        onApproval: (id) => {
          navigated.push(`/approvals/${id}`);
        },
        onRun: (id) => {
          navigated.push(`/runs/${id}`);
        },
        onProject: (id) => {
          navigated.push(`/projects/${id}`);
        },
        onNodes: () => {
          navigated.push("/nodes/local");
        },
      }),
    );
    expect(html).toContain("待审批");
    expect(html).toContain("运行中");
    expect(html).toContain("活跃项目");
    expect(html).toContain("Workforce");
    expect(html).toContain("未知成本");
    expect(html).not.toContain("3/4 在线");
    expect(html).toContain("探测结果待 Daemon 目录接口");
    void navigated;
  });

  it("exposes 新建项目 on the page entry", async () => {
    const { DashboardPage } = await import("./page.js");
    const html = renderToStaticMarkup(
      createElement(DashboardPage, {
        params: {},
        path: "/",
        navigate: (path) => {
          expect(path).toBe("/projects");
        },
      }),
    );
    expect(html).toContain("新建项目");
    expect(html).toContain('data-testid="dashboard-new-project"');
  });
});
