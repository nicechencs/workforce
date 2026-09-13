import { describe, expect, it } from "vitest";

import {
  confirmCreatedDraft,
  confirmPublishedVersion,
  createRoleFormValid,
  createWorkerInputFromForm,
  emptyCreateRoleForm,
} from "./model.js";

describe("role library create/publish helpers", () => {
  it("requires name and role, and does not send Runtime or projectId", () => {
    const empty = emptyCreateRoleForm();
    expect(createRoleFormValid(empty)).toBe(false);
    const form = {
      name: "更严的 reviewer",
      role: "reviewer",
      who: "他是谁",
      how: "",
      skills: "会审 diff",
    };
    expect(createRoleFormValid(form)).toBe(true);
    expect(createWorkerInputFromForm(form)).toEqual({
      name: "更严的 reviewer",
      role: "reviewer",
      who: "他是谁",
      skills: "会审 diff",
    });
  });

  it("refuses to treat a published create response as a library draft", () => {
    expect(() =>
      confirmCreatedDraft({
        id: "wrk_1",
        name: "Nope",
        protocolVersion: "0.1",
        status: "published",
      }),
    ).toThrow(/未发布草稿/);
  });

  it("refuses a draft-looking publish response", () => {
    expect(() =>
      confirmPublishedVersion({
        id: "wv_1",
        workerId: "wrk_1",
        version: "0.1.0",
        status: "draft",
        immutable: false,
        archived: false,
        name: "Nope",
        role: "reviewer",
      }),
    ).toThrow(/已发布 WorkerVersion/);
  });
});
