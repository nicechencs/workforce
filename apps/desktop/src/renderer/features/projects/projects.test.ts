import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ArtifactDto, RunDto } from "@workforce/desktop-client";

import { problemFrom } from "./command.js";
import {
  applyFormFailure,
  applyProjectRefresh,
  artifactKindLabel,
  budgetPlaceholder,
  emptyCreateForm,
  emptyTasksCopy,
  hiddenIllegalActions,
  isDraftConfigComplete,
  nodeScopeLabel,
  pinnedArtifactVersion,
  projectPolicyCopy,
  projectProgressLabel,
  projectStatusLabel,
  publicWorkspaceLabel,
  reduceCreateProjectForm,
  splitProjectRuns,
  taskDependencyLabel,
  taskOwnerLabel,
  visibleProjectActions,
  type ProjectActionInput,
} from "./model.js";
import {
  hashWithProjectTab,
  parseProjectDetailTab,
  parseTabFromHash,
  PROJECT_DETAIL_TAB_LABELS,
  PROJECT_DETAIL_TABS,
} from "./tabs.js";

function actions(partial: Partial<ProjectActionInput> & Pick<ProjectActionInput, "status">) {
  const input: ProjectActionInput = {
    cancelRequested: false,
    workspaceBound: true,
    teamSelected: true,
    runtimeSelected: true,
    capabilities: { pause: false, resume: false, archive: false },
    ...partial,
    status: partial.status,
  };
  return visibleProjectActions(input);
}

function ids(partial: Partial<ProjectActionInput> & Pick<ProjectActionInput, "status">): string[] {
  return actions(partial).map((action) => action.id);
}

describe("create project form", () => {
  it("keeps name and objective when create fails", () => {
    const filled = reduceCreateProjectForm(
      reduceCreateProjectForm(emptyCreateForm, { type: "change", field: "name", value: "Alpha" }),
      { type: "change", field: "objective", value: "Ship the mock feature" },
    );
    const submitted = reduceCreateProjectForm(filled, { type: "submit" });
    const failed = reduceCreateProjectForm(submitted, {
      type: "failure",
      error: new Error("daemon rejected create"),
    });
    expect(failed.name).toBe("Alpha");
    expect(failed.objective).toBe("Ship the mock feature");
    expect(failed.submitting).toBe(false);
    expect(failed.error).toContain("daemon rejected create");
  });

  it("keeps fields on 412 revision_conflict and prompts refresh", () => {
    const filled = reduceCreateProjectForm(
      { ...emptyCreateForm, name: "Edited", objective: "Keep me" },
      { type: "submit" },
    );
    const failed = reduceCreateProjectForm(filled, {
      type: "failure",
      error: problemFrom({
        code: "revision_conflict",
        status: 412,
        title: "Revision conflict",
        detail: "If-Match did not match",
      }),
    });
    expect(failed.name).toBe("Edited");
    expect(failed.objective).toBe("Keep me");
    expect(failed.needsRefresh).toBe(true);
    expect(failed.error).toContain("412");
  });

  it("keeps typed fields when refreshing after a 412", () => {
    const form = applyFormFailure(
      {
        name: "Local edit",
        objective: "Local objective",
        error: null,
        needsRefresh: false,
        submitting: true,
      },
      problemFrom({ code: "revision_conflict", status: 412, detail: "stale" }),
    );
    const refreshed = applyProjectRefresh(
      form,
      { name: "Server name", objective: "Server objective" },
      true,
    );
    expect(refreshed.name).toBe("Local edit");
    expect(refreshed.objective).toBe("Local objective");
    expect(refreshed.needsRefresh).toBe(false);
  });
});

describe("project actions", () => {
  it("hides confirm-plan and start until draft config is complete and status allows them", () => {
    expect(ids({ status: "draft", workspaceBound: false })).toEqual(["startPlanning", "cancel"]);
    expect(actions({ status: "draft", workspaceBound: false })[0]?.enabled).toBe(false);
    expect(
      hiddenIllegalActions({
        status: "draft",
        cancelRequested: false,
        workspaceBound: false,
        teamSelected: true,
        runtimeSelected: true,
        capabilities: { pause: false, resume: false, archive: false },
      }),
    ).toEqual(expect.arrayContaining(["confirmPlan", "startProject", "pause", "archive"]));
  });

  it("does not offer 开始执行 while planning, even if a plan version exists", () => {
    const planning = ids({ status: "planning", planArtifactVersionId: "arv_plan" });
    expect(planning).toContain("confirmPlan");
    expect(planning).not.toContain("startProject");
    expect(planning).not.toContain("startPlanning");
    expect(
      actions({ status: "planning", planArtifactVersionId: "arv_plan" }).find(
        (a) => a.id === "confirmPlan",
      )?.label,
    ).toBe("确认计划");
  });

  it("offers 开始执行 only when ready, and hides pause when capability is false", () => {
    expect(ids({ status: "ready" })).toEqual(["startProject", "cancel"]);
    expect(actions({ status: "ready" }).find((a) => a.id === "startProject")?.label).toBe(
      "开始执行",
    );
    expect(ids({ status: "running" })).toEqual(["cancel"]);
    expect(
      ids({ status: "running", capabilities: { pause: true, resume: false, archive: false } }),
    ).toEqual(["pause", "cancel"]);
  });

  it("never renders archive, including when the capability flag is true", () => {
    expect(
      ids({ status: "ready", capabilities: { pause: false, resume: false, archive: true } }),
    ).not.toContain("archive");
  });

  it("shows 取消中 instead of 已取消 when the API only accepted cancel", () => {
    expect(projectStatusLabel({ status: "running", cancelRequested: true })).toBe("取消中");
    expect(projectStatusLabel({ status: "cancelled", cancelRequested: false })).toBe("已取消");
  });
});

describe("draft config and budget", () => {
  it("requires workspace, preset team, and mock runtime before planning", () => {
    expect(
      isDraftConfigComplete({ workspaceBound: false, teamSelected: true, runtimeSelected: true }),
    ).toBe(false);
    expect(
      isDraftConfigComplete({ workspaceBound: true, teamSelected: true, runtimeSelected: true }),
    ).toBe(true);
  });

  it("does not treat an unpublished or unbound custom team as draft-config complete", () => {
    expect(
      isDraftConfigComplete({ workspaceBound: true, teamSelected: false, runtimeSelected: true }),
    ).toBe(false);
  });

  it("does not display unknown budget as 0", () => {
    expect(budgetPlaceholder(null)).not.toMatch(/\b0\b/);
    expect(budgetPlaceholder({ kind: "unknown", currency: "USD", costMinor: 0 })).toContain("未知");
    expect(budgetPlaceholder({ kind: "unknown", currency: "USD", costMinor: 0 })).not.toContain(
      "预算：0",
    );
  });

  it("shows only the grant label, never an authorization id that looks like a path", () => {
    expect(publicWorkspaceLabel(null)).toBe("未绑定");
    expect(publicWorkspaceLabel({ displayLabel: "repo" })).toBe("repo");
    expect(publicWorkspaceLabel({ displayLabel: "repo" })).not.toContain("/");
  });
});

describe("project detail tabs", () => {
  it("accepts the six IA §4.3 tabs and defaults unknown values to 概览", () => {
    expect(PROJECT_DETAIL_TABS).toEqual([
      "overview",
      "tasks",
      "runs",
      "artifacts",
      "activity",
      "settings",
    ]);
    expect(PROJECT_DETAIL_TAB_LABELS.overview).toBe("概览");
    expect(parseProjectDetailTab("runs")).toBe("runs");
    expect(parseProjectDetailTab("nope")).toBe("overview");
    expect(parseProjectDetailTab(undefined)).toBe("overview");
  });

  it("reads and writes a hash query tab without changing the project path", () => {
    expect(parseTabFromHash("#/projects/prj_1")).toBe("overview");
    expect(parseTabFromHash("#/projects/prj_1?tab=tasks")).toBe("tasks");
    expect(parseTabFromHash("#/projects/prj_1?tab=bogus")).toBe("overview");
    expect(hashWithProjectTab("/projects/prj_1", "overview")).toBe("#/projects/prj_1");
    expect(hashWithProjectTab("/projects/prj_1", "activity")).toBe("#/projects/prj_1?tab=activity");
  });

  it("renders IA tab labels in the page chrome", () => {
    const html = renderToStaticMarkup(
      createElement(
        "nav",
        { "data-testid": "project-detail-tabs" },
        PROJECT_DETAIL_TABS.map((id) =>
          createElement(
            "button",
            { key: id, "data-testid": `project-tab-${id}` },
            PROJECT_DETAIL_TAB_LABELS[id],
          ),
        ),
      ),
    );
    expect(html).toContain("概览");
    expect(html).toContain("Tasks");
    expect(html).toContain("Runs");
    expect(html).toContain("Artifacts");
    expect(html).toContain("Activity");
    expect(html).toContain("Settings");
    expect(html).toContain('data-testid="project-tab-settings"');
  });
});

describe("project detail tab models", () => {
  it("summarizes progress and honest owner/deps copy", () => {
    expect(projectProgressLabel([])).toBe("进度：尚无已发布任务");
    expect(
      projectProgressLabel([{ status: "completed" }, { status: "running" }, { status: "ready" }]),
    ).toBe("进度：1/3 已完成 · 1 进行中");
    expect(taskOwnerLabel({})).toBe("未指定");
    expect(taskOwnerLabel({ role: "developer" })).toBe("developer");
    expect(taskDependencyLabel()).toBe("依赖：未返回");
    expect(taskDependencyLabel({ dependsOn: [] })).toBe("依赖：无");
    expect(
      taskDependencyLabel({ dependsOn: [{ taskId: "tsk_a", waitFor: "outputs_ready" }] }, [
        { id: "tsk_a", title: "Alpha", workflowNodeId: "dev_alpha" },
      ]),
    ).toBe("依赖：dev_alpha（outputs_ready）");
    expect(emptyTasksCopy("draft")).toContain("确认计划");
    expect(emptyTasksCopy("running")).toBe("暂无任务。");
    expect(nodeScopeLabel()).toContain("本机");
    expect(projectPolicyCopy({ pause: false, resume: false, archive: false })).toContain(
      "尚未接入",
    );
  });

  it("splits current and historical runs and pins the highest artifact version", () => {
    const run = (id: string, status: string, createdAt: string): RunDto => ({
      id,
      taskId: "tsk_1",
      projectId: "prj_1",
      status,
      stateRevision: 1,
      definitionRevision: 1,
      generation: 1,
      attempt: 1,
      protocolVersion: "0.1",
      cancelRequested: false,
      usage: { costMinor: 0, currency: "USD", kind: "unknown" },
      createdAt,
      updatedAt: createdAt,
    });
    const split = splitProjectRuns([
      run("run_old", "succeeded", "2026-09-10T00:00:00.000Z"),
      run("run_now", "running", "2026-09-10T01:00:00.000Z"),
    ]);
    expect(split.current.map((item) => item.id)).toEqual(["run_now"]);
    expect(split.history.map((item) => item.id)).toEqual(["run_old"]);

    const artifact: ArtifactDto = {
      id: "art_1",
      projectId: "prj_1",
      logicalName: "diff",
      kind: "git_diff",
      createdAt: "2026-09-10T00:00:00.000Z",
      versions: [
        {
          id: "arv_1",
          version: 1,
          status: "available",
          hash: "sha256:aaa",
          size: 10,
          createdAt: "2026-09-10T00:00:00.000Z",
        },
        {
          id: "arv_2",
          version: 2,
          status: "available",
          hash: "sha256:bbb",
          size: 12,
          createdAt: "2026-09-10T01:00:00.000Z",
        },
      ],
    };
    expect(artifactKindLabel("git_diff")).toBe("代码");
    expect(pinnedArtifactVersion(artifact)?.id).toBe("arv_2");
    expect(pinnedArtifactVersion({ versions: [] })).toBeNull();
  });
});
