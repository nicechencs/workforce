import { describe, expect, it } from "vitest";

import { PRESET_TEAM, rejectCustomTeamSave, teamPageModel } from "./model.js";

describe("team pages", () => {
  it("is read-only and does not expose create/edit/save actions", () => {
    const model = teamPageModel();
    expect(model.readonly).toBe(true);
    expect(model.canCreate).toBe(false);
    expect(model.canEdit).toBe(false);
    expect(model.saveLooksSuccessful).toBe(false);
    expect(model.actions).toEqual([]);
    expect(model.teams).toEqual([PRESET_TEAM]);
    expect(model.note).toContain("GET /teams");
    expect(PRESET_TEAM.workers.map((worker) => worker.role)).toEqual([
      "planner",
      "developer",
      "reviewer",
    ]);
    expect(PRESET_TEAM.runtime.label).toBe("Mock");
  });

  it("does not fake a successful custom team save", () => {
    const result = rejectCustomTeamSave();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("只读");
  });

  it("keeps live teams read-only when GET /teams is available", () => {
    const model = teamPageModel({
      liveTeams: [{ ...PRESET_TEAM, id: "software-development-team", name: "Live Team" }],
    });
    expect(model.source).toBe("live");
    expect(model.readonly).toBe(true);
    expect(model.canCreate).toBe(false);
    expect(model.teams[0]?.readonly).toBe(true);
  });
});
