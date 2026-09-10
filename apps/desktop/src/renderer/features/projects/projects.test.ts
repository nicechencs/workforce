import { describe, expect, it } from "vitest";

import { problemFrom } from "./command.js";
import {
  applyFormFailure,
  applyProjectRefresh,
  budgetPlaceholder,
  emptyCreateForm,
  hiddenIllegalActions,
  isDraftConfigComplete,
  projectStatusLabel,
  publicWorkspaceLabel,
  reduceCreateProjectForm,
  visibleProjectActions,
  type ProjectActionInput,
} from "./model.js";

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
