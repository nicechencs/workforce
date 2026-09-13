import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProjectTeamBindingField } from "./page.js";

import { problemFrom } from "../projects/command.js";
import {
  PRESET_TEAM,
  TEAM_WRITE_API_MISSING,
  type TeamView,
  UNPUBLISHED_BIND_REASON,
  addDraftMember,
  asTeamView,
  bindableTeams,
  canBindTeamVersion,
  createTeamButton,
  draftMembersValid,
  emptyTeamDraftForm,
  interpretPublishResponse,
  isPresetTeamId,
  isPublishedTeamVersion,
  isTeamReadyForPlanning,
  loadTeamCatalog,
  loadTeamDetail,
  membersToPayload,
  mergeCatalogTeams,
  persistTeamDraft,
  probeTeamWriteSupport,
  projectTeamVersionId,
  publishPersistedTeamVersion,
  publishTeamButton,
  reduceTeamDraftForm,
  rejectCustomTeamPublish,
  rejectCustomTeamSave,
  rejectUnpublishedBind,
  supportFromFlags,
  teamPageModel,
  unavailableTeamWriteSupport,
  updateDraftMember,
} from "./model.js";

const writeLive = supportFromFlags({
  methodsPresent: true,
  versionRead: true,
  bindMethod: true,
});

describe("team pages", () => {
  it("keeps the preset read-only when write APIs are missing", () => {
    const model = teamPageModel();
    expect(model.readonly).toBe(true);
    expect(model.canCreate).toBe(false);
    expect(model.canEdit).toBe(false);
    expect(model.canPublish).toBe(false);
    expect(model.saveLooksSuccessful).toBe(false);
    expect(model.publishLooksSuccessful).toBe(false);
    expect(model.actions).toEqual([]);
    expect(model.teams).toEqual([PRESET_TEAM]);
    expect(model.note).toContain("GET /teams");
    expect(model.note).toContain("写接口尚未接通");
    expect(PRESET_TEAM.workers.map((worker) => worker.role)).toEqual([
      "planner",
      "developer",
      "reviewer",
    ]);
    expect(PRESET_TEAM.members.map((member) => member.quantity)).toEqual([1, 1, 1]);
    expect(PRESET_TEAM.runtime.label).toBe("Mock");
    expect(PRESET_TEAM.readonly).toBe(true);
    expect(PRESET_TEAM.kind).toBe("preset");
  });

  it("does not fake a successful custom team save or publish", () => {
    const save = rejectCustomTeamSave();
    expect(save.ok).toBe(false);
    expect(save.reason).toContain("只读");
    const publish = rejectCustomTeamPublish();
    expect(publish.ok).toBe(false);
    expect(publish.reason).toContain("写接口尚未接通");
    expect(createTeamButton(unavailableTeamWriteSupport()).enabled).toBe(false);
    expect(createTeamButton(unavailableTeamWriteSupport()).looksSuccessful).toBe(false);
    expect(publishTeamButton(unavailableTeamWriteSupport()).enabled).toBe(false);
    expect(publishTeamButton(unavailableTeamWriteSupport()).looksSuccessful).toBe(false);
  });

  it("keeps live preset cards read-only when GET /teams is available", () => {
    const model = teamPageModel({
      liveTeams: [
        { ...PRESET_TEAM, id: "tm_software_development", name: "Software Development Team" },
      ],
    });
    expect(model.source).toBe("live");
    expect(model.readonly).toBe(true);
    expect(model.canCreate).toBe(false);
    expect(model.teams[0]?.readonly).toBe(true);
    expect(model.teams[0]?.kind).toBe("preset");
  });

  it("enables create/publish only after a live TeamVersion read probe", () => {
    const methodsOnly = supportFromFlags({
      methodsPresent: true,
      versionRead: false,
      bindMethod: true,
    });
    expect(teamPageModel({ writeSupport: methodsOnly }).canCreate).toBe(false);
    expect(createTeamButton(methodsOnly).enabled).toBe(false);
    const live = teamPageModel({
      liveTeams: [PRESET_TEAM, publishedCustom()],
      writeSupport: writeLive,
    });
    expect(live.canCreate).toBe(true);
    expect(live.canPublish).toBe(true);
    expect(live.canBind).toBe(true);
    expect(live.readonly).toBe(false);
    expect(live.saveLooksSuccessful).toBe(false);
    expect(createTeamButton(writeLive).enabled).toBe(true);
    expect(createTeamButton(writeLive).looksSuccessful).toBe(false);
  });
});

describe("team write probe", () => {
  it("stays disabled when getTeamVersion is missing or 404s", async () => {
    await expect(
      probeTeamWriteSupport({
        createTeam: async () => undefined,
        patchTeam: async () => undefined,
        createTeamVersion: async () => undefined,
        patchTeamVersion: async () => undefined,
        publishTeamVersion: async () => undefined,
        getTeam: async () => undefined,
        patchProject: async () => undefined,
        listTeams: async () => ({ items: [PRESET_TEAM] }),
      }),
    ).resolves.toMatchObject({ create: false, publish: false, bind: false, versionRead: false });

    await expect(
      probeTeamWriteSupport({
        createTeam: async () => undefined,
        patchTeam: async () => undefined,
        createTeamVersion: async () => undefined,
        patchTeamVersion: async () => undefined,
        publishTeamVersion: async () => undefined,
        getTeam: async () => undefined,
        getTeamVersion: async () => {
          throw problemFrom({ code: "not_found", status: 404, detail: "missing route" });
        },
        patchProject: async () => undefined,
        listTeams: async () => ({ items: [{ id: "tm_software_development", version: "0.1.0" }] }),
      }),
    ).resolves.toMatchObject({ create: false, versionRead: false });
  });

  it("enables write actions when preset getTeamVersion succeeds even if listTeams is empty", async () => {
    const support = await probeTeamWriteSupport({
      createTeam: async () => undefined,
      patchTeam: async () => undefined,
      createTeamVersion: async () => undefined,
      patchTeamVersion: async () => undefined,
      publishTeamVersion: async () => undefined,
      getTeam: async () => undefined,
      getTeamVersion: async (id, versionId) => {
        if (id !== "tm_software_development" || versionId !== "0.1.0") {
          throw problemFrom({ code: "not_found", status: 404, detail: "unexpected probe" });
        }
        return {
          id: "tmv_software_development_0_1_0",
          teamId: "tm_software_development",
          version: "0.1.0",
          status: "published",
          immutable: true,
          members: [],
        };
      },
      patchProject: async () => undefined,
      listTeams: async () => ({ items: [] }),
    });
    expect(support).toEqual({
      methodsPresent: true,
      versionRead: true,
      create: true,
      publish: true,
      bind: true,
    });
  });
});

describe("publish and bind honesty", () => {
  it("does not treat a draft or empty publish response as success", () => {
    expect(isPublishedTeamVersion({ id: "tmv_1", status: "draft", version: "0.2.0" })).toBe(false);
    expect(isPublishedTeamVersion({ id: "tmv_1", status: "published", version: "0.2.0" })).toBe(
      false,
    );
    expect(interpretPublishResponse({ id: "tmv_1", status: "draft", version: "0.2.0" }).ok).toBe(
      false,
    );
    expect(
      interpretPublishResponse({
        id: "tmv_1",
        status: "published",
        immutable: true,
        version: "0.2.0",
      }),
    ).toEqual({
      ok: true,
      published: true,
      versionId: "tmv_1",
    });
    expect(
      interpretPublishResponse({
        id: "tmv_1",
        status: "published",
        immutable: true,
        version: "0.2.0",
        publishedAt: "",
      }).ok,
    ).toBe(false);
  });

  it("refuses to bind unpublished drafts and does not enable start-planning", () => {
    const draft = {
      ...publishedCustom(),
      status: "draft" as const,
      readonly: false,
    };
    expect(canBindTeamVersion(draft)).toBe(false);
    expect(rejectUnpublishedBind(draft)).toEqual({ ok: false, reason: UNPUBLISHED_BIND_REASON });
    expect(bindableTeams([PRESET_TEAM, draft, publishedCustom()]).map((team) => team.id)).toEqual([
      PRESET_TEAM.id,
      "tm_custom",
    ]);
    expect(
      isTeamReadyForPlanning({
        selection: {
          teamId: draft.id,
          versionId: draft.versionId,
          status: "draft",
          kind: "custom",
        },
        projectTeamVersionId: null,
      }),
    ).toBe(false);
  });

  it("enables planning for the preset, but not for an unbound custom TeamVersion", () => {
    expect(
      isTeamReadyForPlanning({
        selection: {
          teamId: PRESET_TEAM.id,
          versionId: PRESET_TEAM.versionId,
          status: "published",
          kind: "preset",
        },
        projectTeamVersionId: null,
      }),
    ).toBe(true);
    expect(
      isTeamReadyForPlanning({
        selection: {
          teamId: "tm_custom",
          versionId: "tmv_custom_1",
          status: "published",
          kind: "custom",
        },
        projectTeamVersionId: null,
      }),
    ).toBe(false);
    expect(
      isTeamReadyForPlanning({
        selection: {
          teamId: "tm_custom",
          versionId: "tmv_custom_1",
          status: "published",
          kind: "custom",
        },
        projectTeamVersionId: "tmv_custom_1",
      }),
    ).toBe(true);
    expect(projectTeamVersionId({ id: "prj_1" })).toBeNull();
    expect(projectTeamVersionId({ id: "prj_1", teamVersionId: "tmv_custom_1" })).toBe(
      "tmv_custom_1",
    );
  });
});

describe("team draft form", () => {
  it("keeps members on 412 and never marks publish success", () => {
    const edited = reduceTeamDraftForm(emptyTeamDraftForm(), {
      type: "setMembers",
      members: updateDraftMember(emptyTeamDraftForm().members, 1, { quantity: 3 }),
    });
    const submitted = reduceTeamDraftForm(edited, { type: "submit", action: "publish" });
    const failed = reduceTeamDraftForm(submitted, {
      type: "failure",
      error: problemFrom({
        code: "revision_conflict",
        status: 412,
        title: "Revision conflict",
        detail: "If-Match did not match",
      }),
    });
    expect(failed.members[1]?.quantity).toBe(3);
    expect(failed.published).toBe(false);
    expect(failed.needsRefresh).toBe(true);
    expect(failed.error).toContain("412");
    expect(failed.name).toBe(edited.name);
  });

  it("only marks published after an explicit published event", () => {
    const saved = reduceTeamDraftForm(emptyTeamDraftForm(), {
      type: "saved",
      teamId: "tm_1",
      versionId: "tmv_1",
    });
    expect(saved.saved).toBe(true);
    expect(saved.published).toBe(false);
    const published = reduceTeamDraftForm(saved, {
      type: "published",
      teamId: "tm_1",
      versionId: "tmv_1",
    });
    expect(published.published).toBe(true);
  });

  it("requires a published workerVersionId and quantity >= 1", () => {
    expect(draftMembersValid(PRESET_TEAM.members)).toBe(true);
    expect(draftMembersValid(updateDraftMember(PRESET_TEAM.members, 0, { quantity: 0 }))).toBe(
      false,
    );
    expect(draftMembersValid(updateDraftMember(PRESET_TEAM.members, 0, { role: "" }))).toBe(false);
    expect(
      draftMembersValid(updateDraftMember(PRESET_TEAM.members, 0, { workerVersionId: "" })),
    ).toBe(false);
    expect(
      addDraftMember(PRESET_TEAM.members, {
        workerId: "wrk_software_developer",
        workerName: "Developer",
        workerVersionId: "wrv_software_developer_0_1_0",
        version: "0.1.0",
        name: "Developer",
        role: "developer",
        archived: false,
        status: "published",
        immutable: true,
      }),
    ).toHaveLength(4);
  });
});

describe("project team binding field", () => {
  it("disables custom bind when write APIs are missing and lists unpublished drafts as not bindable", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectTeamBindingField, {
        teams: [
          PRESET_TEAM,
          publishedCustom(),
          { ...publishedCustom(), id: "tm_draft", status: "draft" },
        ],
        writeSupport: unavailableTeamWriteSupport(),
        selection: { teamId: "tm_custom", versionId: "tmv_custom_1" },
        projectTeamVersionId: null,
        disabled: false,
        busy: false,
        error: null,
        onSelect: () => undefined,
        onBind: () => undefined,
      }),
    );
    expect(html).toContain("project-bind-team");
    expect(html).toContain("disabled");
    expect(html).toContain("project-team-unpublished");
    expect(html).toContain("开始规划");
    expect(html).not.toContain("已绑定成功");
  });
});

describe("team catalog parsing", () => {
  it("parses roles, members, and live preset aliases without inventing a write success", () => {
    expect(isPresetTeamId("tm_software_development")).toBe(true);
    const fromRoles = asTeamView({
      id: "tm_software_development",
      name: "Software Development Team",
      version: "0.1.0",
      status: "published",
      roles: [{ id: "planner", role: "planner", version: "0.1.0" }],
    });
    expect(fromRoles?.kind).toBe("preset");
    expect(fromRoles?.members[0]).toMatchObject({
      role: "planner",
      runtimeProfile: "mock",
      quantity: 1,
    });
    const custom = asTeamView({
      id: "tm_custom",
      name: "Docs team",
      version: "0.2.0",
      status: "draft",
      members: [
        {
          role: "developer",
          runtimeProfileId: "mock",
          quantity: 2,
          title: "Dev",
          workerVersionId: "wrv_docs_developer_0_1_0",
        },
      ],
    });
    expect(custom).toMatchObject({
      kind: "custom",
      status: "draft",
      readonly: false,
      members: [
        {
          role: "developer",
          quantity: 2,
          runtimeProfile: "mock",
          workerVersionId: "wrv_docs_developer_0_1_0",
        },
      ],
    });
    const fromVersions = asTeamView({
      id: "tm_software_development",
      name: "Software Development Team",
      version: "0.1.0",
      status: "published",
      activeVersionId: "tmv_software_development_0_1_0",
      versions: [
        {
          id: "tmv_software_development_0_1_0",
          teamId: "tm_software_development",
          version: "0.1.0",
          status: "published",
          immutable: true,
          stateRevision: 1,
          members: [
            { id: "planner", role: "planner", runtimeProfileId: "mock", quantity: 1 },
            { id: "developer", role: "developer", runtimeProfileId: "mock", quantity: 2 },
            { id: "reviewer", role: "reviewer", runtimeProfileId: "mock", quantity: 1 },
          ],
        },
      ],
    });
    expect(fromVersions?.versionId).toBe("tmv_software_development_0_1_0");
    expect(fromVersions?.members.map((member) => member.quantity)).toEqual([1, 2, 1]);
    expect(membersToPayload(custom!.members)).toEqual([
      {
        workerVersionId: "wrv_docs_developer_0_1_0",
        role: "developer",
        runtimeProfileId: "mock",
        quantity: 2,
      },
    ]);
    const merged = mergeCatalogTeams([custom!]);
    expect(merged[0]).toEqual(PRESET_TEAM);
    expect(merged[1]?.id).toBe("tm_custom");
    expect(TEAM_WRITE_API_MISSING).toContain("只读");
  });
});

describe("team draft persistence", () => {
  it("creates via write methods and still resolves after a catalog-only reload miss", async () => {
    const store = new Map<string, unknown>();
    const client = memoryTeamClient(store);
    const result = await persistTeamDraft(
      client,
      {
        name: "Squad",
        members: [
          {
            id: "developer",
            role: "developer",
            title: "Developer",
            runtimeProfile: "mock",
            quantity: 2,
            workerVersionId: "wrv_software_developer_0_1_0",
          },
        ],
        teamId: null,
        versionId: null,
      },
      () => ({ idempotencyKey: "idem_1", operationId: "op_1" }),
    );
    expect(result.teamId).toBe("tm_1");
    expect(result.versionId).toBe("tmv_1");
    expect(result.team.status).toBe("draft");
    expect(client.calls).toEqual(["createTeam", "createTeamVersion", "getTeam"]);
    expect(client.lastMembers).toEqual([
      {
        workerVersionId: "wrv_software_developer_0_1_0",
        role: "developer",
        runtimeProfileId: "mock",
        quantity: 2,
      },
    ]);

    const reloaded = await loadTeamDetail(client, "tm_1", []);
    expect(reloaded?.name).toBe("Squad");
    expect(reloaded?.status).toBe("draft");
    expect(reloaded?.members[0]).toMatchObject({ role: "developer", quantity: 2 });

    const catalogAfterReload = await loadTeamCatalog(client);
    expect(catalogAfterReload.find((team) => team.id === "tm_1")).toMatchObject({
      name: "Squad",
      status: "draft",
      members: [{ role: "developer", quantity: 2 }],
    });
    expect(client.listCalls).toEqual([undefined, { status: "draft" }]);
  });

  it("refuses to mark publish success unless the version is published and immutable", async () => {
    const store = new Map<string, unknown>();
    const client = memoryTeamClient(store);
    await persistTeamDraft(
      client,
      {
        name: "Squad",
        members: PRESET_TEAM.members,
        teamId: null,
        versionId: null,
      },
      () => ({ idempotencyKey: "idem_1", operationId: "op_1" }),
    );
    client.publishResult = {
      id: "tmv_1",
      status: "draft",
      immutable: false,
      version: "0.1.0",
    };
    await expect(
      publishPersistedTeamVersion(client, { teamId: "tm_1", versionId: "tmv_1" }, () => ({
        idempotencyKey: "idem_2",
        operationId: "op_2",
      })),
    ).resolves.toMatchObject({ ok: false, published: false });
    client.publishResult = {
      id: "tmv_1",
      status: "published",
      immutable: true,
      version: "0.1.0",
    };
    await expect(
      publishPersistedTeamVersion(client, { teamId: "tm_1", versionId: "tmv_1" }, () => ({
        idempotencyKey: "idem_3",
        operationId: "op_3",
      })),
    ).resolves.toEqual({
      ok: true,
      published: true,
      versionId: "tmv_1",
      team: expect.objectContaining({
        id: "tm_1",
        status: "published",
        versionId: "tmv_1",
      }),
    });
  });
});

function memoryTeamClient(store: Map<string, unknown>) {
  const client = {
    calls: [] as string[],
    listCalls: [] as Array<{ status?: string } | undefined>,
    lastMembers: [] as unknown[],
    publishResult: undefined as unknown,
    listTeams: async (query?: { status?: string }) => {
      client.listCalls.push(query);
      const items = [...store.values()].filter((item) => {
        const status = (item as { status?: string }).status;
        return query?.status === "draft" ? status === "draft" : status === "published";
      });
      return { items };
    },
    createTeam: async (input: { name: string }) => {
      client.calls.push("createTeam");
      const team = {
        id: "tm_1",
        name: input.name,
        status: "draft",
        stateRevision: 1,
        protocolVersion: "0.1",
        version: "",
        roles: [],
      };
      store.set("tm_1", team);
      return team;
    },
    patchTeam: async (id: string, input: { name?: string }) => {
      client.calls.push("patchTeam");
      const current = store.get(id) as Record<string, unknown>;
      const next = { ...current, ...input, stateRevision: Number(current.stateRevision ?? 1) + 1 };
      store.set(id, next);
      return next;
    },
    createTeamVersion: async (
      id: string,
      input: { members: Array<{ workerVersionId: string; role: string; quantity: number }> },
    ) => {
      client.calls.push("createTeamVersion");
      client.lastMembers = input.members;
      const version = {
        id: "tmv_1",
        teamId: id,
        version: "0.1.0",
        status: "draft",
        immutable: false,
        members: input.members,
        stateRevision: 1,
      };
      const current = store.get(id) as Record<string, unknown>;
      store.set(id, {
        ...current,
        version: "0.1.0",
        activeVersionId: "tmv_1",
        versions: [version],
        stateRevision: Number(current.stateRevision ?? 1) + 1,
      });
      return version;
    },
    patchTeamVersion: async () => {
      client.calls.push("patchTeamVersion");
      return store.get("tmv_1");
    },
    publishTeamVersion: async () => {
      client.calls.push("publishTeamVersion");
      const published = client.publishResult as
        | {
            id?: string;
            status?: string;
            immutable?: boolean;
            version?: string;
          }
        | undefined;
      if (published?.status === "published") {
        const current = (store.get("tm_1") as Record<string, unknown> | undefined) ?? {};
        const version = {
          id: published.id ?? "tmv_1",
          teamId: "tm_1",
          version: published.version ?? "0.1.0",
          status: "published",
          immutable: published.immutable === true,
          members: Array.isArray(current.members) ? current.members : [],
        };
        store.set("tm_1", {
          ...current,
          id: "tm_1",
          status: "published",
          version: version.version,
          versionId: version.id,
          activeVersionId: version.id,
          versions: [version],
        });
      }
      return client.publishResult;
    },
    getTeam: async (id: string) => {
      client.calls.push("getTeam");
      const found = store.get(id);
      if (!found) {
        throw problemFrom({ code: "not_found", status: 404, detail: "missing team" });
      }
      return found;
    },
    getTeamVersion: async () => ({ id: "tmv_1", version: "0.1.0" }),
  };
  return client;
}

function publishedCustom(): TeamView {
  return {
    id: "tm_custom",
    name: "Docs team",
    version: "0.2.0",
    versionId: "tmv_custom_1",
    kind: "custom",
    status: "published",
    readonly: true,
    runtime: { adapterId: "mock", label: "Mock" },
    members: [
      {
        id: "developer",
        role: "developer",
        title: "Developer",
        runtimeProfile: "mock",
        quantity: 2,
      },
    ],
    workers: [{ id: "developer", role: "developer", title: "Developer", runtime: "Mock" }],
  };
}
