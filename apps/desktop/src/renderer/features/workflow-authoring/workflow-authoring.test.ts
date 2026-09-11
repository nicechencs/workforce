import { DesktopClient, paths } from "@workforce/desktop-client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { loadFeatureModules } from "../../app/feature-modules.js";
import { WorkflowAuthoringEntry } from "./entry.js";
import * as authoringModule from "./index.js";
import {
  AGENT_REPLY_GAP,
  AUTHORING_ROUTE_GAP,
  CHAT_SESSION_GAP,
  CHAT_SESSION_PROTOCOL_FROZEN,
  buildDraftGraph,
  canAppendUserMessage,
  canvasEditLink,
  emptyAuthoringModel,
  isWorkflowAuthoringHash,
  landedDraftProjection,
  landUnpublishedDraft,
  parseStructuredIntent,
  proposalDraftFromForm,
  reduceAuthoring,
  rejectChatSubmit,
  type AuthoringSessionDto,
  type AuthoringWriteClient,
  type LandedDraft,
} from "./model.js";
import { WorkflowAuthoringPage } from "./page.js";
import {
  AUTHORING_SESSION_STORAGE_KEY,
  DESKTOP_LOCAL_AUTHORING_PROJECT_ID,
  InProcessAuthoringSessionStore,
  createMemoryAuthoringSessionStorage,
} from "./session-store.js";

function filledForm() {
  return {
    ...emptyAuthoringModel().form,
    name: "功能交付",
    description: "项目循环草稿",
    rolesText: "planner\ndeveloper",
    stepsText: "规划\n实现",
    intentText: "创建 bot1 和 bot2，跑流程 X",
    teamName: "演示小队",
  };
}

function fakeWorkflow(id = "wfd_1") {
  return {
    id,
    name: "功能交付",
    description: "项目循环草稿",
    protocolVersion: "0.1" as const,
    status: "draft" as const,
    versions: [],
    stateRevision: 1,
    definitionRevision: 1,
  };
}

function fakeVersion(workflowId = "wfd_1") {
  return {
    id: "wfv_1",
    workflowId,
    version: "1",
    status: "draft" as const,
    immutable: false,
    stateRevision: 1,
  };
}

describe("workflow-authoring protocol honesty", () => {
  it("wires user-append + local store without inventing a Daemon chat path", () => {
    expect(CHAT_SESSION_PROTOCOL_FROZEN).toBe(true);
    expect(CHAT_SESSION_GAP).toContain("AuthoringSessionDto");
    expect(CHAT_SESSION_GAP).toContain("Desktop-local");
    expect(CHAT_SESSION_GAP).toContain("Daemon chat");
    expect(AGENT_REPLY_GAP).toContain("planned");
    const compileOnly: AuthoringSessionDto | null = null;
    expect(compileOnly).toBeNull();
    const model = emptyAuthoringModel();
    expect(model.chat.enabled).toBe(true);
    expect(model.chat.submitEnabled).toBe(false);
    expect(model.chat.agentReplyPlanned).toBe(true);
    expect(model.chat.messages).toEqual([]);
    expect(model.chat.explanation).toBe(CHAT_SESSION_GAP);
    expect(model.routeGap).toBe(AUTHORING_ROUTE_GAP);
    expect(rejectChatSubmit().ok).toBe(false);
    expect(rejectChatSubmit().reason).toBe(AGENT_REPLY_GAP);
    expect(canvasEditLink("wfd_1", "wfv_1").available).toBe(true);
    expect(canvasEditLink("wfd_1", "wfv_1").href).toBe("/workflows/wfd_1/versions/wfv_1");
    const methodNames = Object.getOwnPropertyNames(DesktopClient.prototype);
    expect(methodNames.some((name) => /chat|authoringSession|appendAuthoring/i.test(name))).toBe(
      false,
    );
    expect(Object.keys(paths).some((name) => /chat|authoring/i.test(name))).toBe(false);
    expect(JSON.stringify(paths)).not.toMatch(/authoring-session|\/chat|conversational/i);
  });

  it("does not register a feature slot that would overwrite workflows", () => {
    expect("feature" in authoringModule).toBe(false);
    expect(
      loadFeatureModules({
        "../features/workflow-authoring/index.tsx": authoringModule,
      }),
    ).toEqual([]);
  });

  it("opens only from the workflows hash query, not a new catalog path", () => {
    expect(isWorkflowAuthoringHash("#/workflows?authoring=1")).toBe(true);
    expect(isWorkflowAuthoringHash("#/workflows")).toBe(false);
    expect(isWorkflowAuthoringHash("#/workflows/wfd_1?authoring=1")).toBe(false);
    expect(isWorkflowAuthoringHash("#/projects?authoring=1")).toBe(false);
  });
});

describe("structured intent", () => {
  it("rejects free-text-only intent instead of inventing an Agent draft", () => {
    const parsed = parseStructuredIntent({
      ...emptyAuthoringModel().form,
      intentText: "请生成一个完整工作流",
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.code).toBe("empty_intent");
    expect(parsed.reason).toContain("编排 Agent 尚未接线");
  });

  it("rejects a blank form without claiming generation succeeded", () => {
    const parsed = parseStructuredIntent(emptyAuthoringModel().form);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      return;
    }
    expect(parsed.code).toBe("validation_failed");
  });

  it("maps structured fields to an unpublished graph payload", () => {
    const parsed = parseStructuredIntent(filledForm());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.intent.name).toBe("功能交付");
    expect(parsed.intent.teamName).toBe("演示小队");
    expect(parsed.intent.graph.entry).toBe("step_1");
    expect(parsed.intent.graph.nodes).toEqual([
      { id: "step_1", kind: "task", title: "规划", role: "planner" },
      { id: "step_2", kind: "task", title: "实现", role: "developer" },
    ]);
    expect(parsed.intent.graph.edges).toEqual([
      { id: "edge_1", from: "step_1", to: "step_2", waitFor: "outputs_ready" },
    ]);
  });

  it("allows a name-only draft with an empty graph", () => {
    expect(buildDraftGraph([], []).nodes).toBeUndefined();
    const parsed = parseStructuredIntent({ ...emptyAuthoringModel().form, name: "空白草稿" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.intent.graph).toEqual({});
  });
});

describe("authoring reducer", () => {
  it("keeps typed fields after empty intent, validation, missing session, and write failure", () => {
    const typed = reduceAuthoring(emptyAuthoringModel(), {
      type: "change",
      field: "intentText",
      value: "请生成",
    });
    const named = reduceAuthoring(typed, { type: "change", field: "name", value: "" });
    const empty = reduceAuthoring(named, { type: "submitDraft" });
    expect(empty.phase).toBe("empty_intent");
    expect(empty.form.intentText).toBe("请生成");
    expect(empty.draft).toBeNull();
    expect(empty.chat.messages).toEqual([]);

    const invalid = reduceAuthoring(emptyAuthoringModel(), { type: "submitDraft" });
    expect(invalid.phase).toBe("validation_failed");
    expect(invalid.form).toEqual(emptyAuthoringModel().form);

    const chat = reduceAuthoring(typed, { type: "submitChat" });
    expect(chat.phase).toBe("failed");
    expect(chat.error).toContain("本机会话尚未建立");
    expect(chat.form.intentText).toBe("请生成");
    expect(chat.chat.messages).toEqual([]);
    expect(canAppendUserMessage(typed).ok).toBe(false);

    const failed = reduceAuthoring(
      reduceAuthoring(emptyAuthoringModel(), { type: "change", field: "name", value: "保留我" }),
      { type: "failure", error: new Error("daemon rejected create") },
    );
    expect(failed.phase).toBe("failed");
    expect(failed.form.name).toBe("保留我");
    expect(failed.draft).toBeNull();
    expect(failed.error).toContain("daemon rejected create");
  });

  it("records a user append and a landed draft without inventing an Agent success thread", () => {
    const store = new InProcessAuthoringSessionStore();
    const session = store.create({ projectId: "prj_1" });
    const ready = reduceAuthoring(emptyAuthoringModel(), { type: "sessionHydrated", session });
    const typed = reduceAuthoring(ready, {
      type: "change",
      field: "intentText",
      value: "请生成",
    });
    expect(typed.chat.submitEnabled).toBe(true);
    const submitted = reduceAuthoring(typed, { type: "submitChat" });
    expect(submitted.phase).toBe("idle");
    const appended = store.appendUserMessage({
      sessionId: session.id,
      role: "user",
      content: "请生成",
    });
    const updated = reduceAuthoring(submitted, {
      type: "sessionUpdated",
      session: appended,
      clearIntent: true,
    });
    expect(updated.form.intentText).toBe("");
    expect(updated.chat.messages).toHaveLength(1);
    expect(updated.chat.messages[0]?.role).toBe("user");
    expect(updated.chat.messages.some((message) => message.role === "authoring_agent")).toBe(false);

    const draft: LandedDraft = {
      workflowId: "wfd_1",
      workflowName: "功能交付",
      versionId: "wfv_1",
      status: "draft",
      unpublished: true,
      catalogHref: "/workflows/wfd_1",
      canvas: canvasEditLink("wfd_1", "wfv_1"),
    };
    const named = reduceAuthoring(updated, { type: "change", field: "name", value: "功能交付" });
    const landed = reduceAuthoring(named, { type: "landed", draft });
    expect(landed.phase).toBe("landed");
    expect(landed.form.name).toBe("功能交付");
    expect(landed.form.intentText).toBe("");
    expect(landed.chat.messages).toHaveLength(1);
    expect(landed.chat.messages[0]?.role).toBe("user");
    expect(landed.chat.submitEnabled).toBe(false);
    expect(landed.draft?.unpublished).toBe(true);
    expect(landedDraftProjection(draft).kind).toBe("landed");
  });

  it("keeps existing user messages when append or write fails", () => {
    const store = new InProcessAuthoringSessionStore();
    const session = store.appendUserMessage({
      sessionId: store.create({ projectId: "prj_keep" }).id,
      role: "user",
      content: "先记下",
    });
    const ready = reduceAuthoring(
      reduceAuthoring(emptyAuthoringModel(), { type: "sessionHydrated", session }),
      { type: "change", field: "intentText", value: "再补一句" },
    );
    const appendFailed = reduceAuthoring(ready, {
      type: "appendFailed",
      error: new Error("store rejected append"),
    });
    expect(appendFailed.form.intentText).toBe("再补一句");
    expect(appendFailed.chat.messages[0]?.content).toBe("先记下");
    expect(appendFailed.error).toContain("store rejected append");

    const writeFailed = reduceAuthoring(
      reduceAuthoring(appendFailed, { type: "change", field: "name", value: "保留我" }),
      { type: "failure", error: new Error("daemon rejected create") },
    );
    expect(writeFailed.form.name).toBe("保留我");
    expect(writeFailed.form.intentText).toBe("再补一句");
    expect(writeFailed.chat.messages[0]?.content).toBe("先记下");
  });
});

describe("in-process authoring session store", () => {
  it("creates, loads, and appends user messages against the frozen DTO", () => {
    const store = new InProcessAuthoringSessionStore({
      now: () => "2026-09-12T00:00:00.000Z",
      id: (prefix) => `${prefix}test`,
    });
    const created = store.create({
      projectId: "prj_1",
      intentText: " 创建 planner 跑功能交付 ",
    });
    expect(created.id).toMatch(/^cas_/);
    expect(created.projectId).toBe("prj_1");
    expect(created.protocolVersion).toBe("0.1");
    expect(created.status).toBe("open");
    expect(created.messages).toEqual([
      {
        id: "cam_test",
        role: "user",
        content: "创建 planner 跑功能交付",
        createdAt: "2026-09-12T00:00:00.000Z",
      },
    ]);
    expect(store.load(created.id)).toEqual(created);

    const appended = store.appendUserMessage({
      sessionId: created.id,
      role: "user",
      content: " 再加审查 ",
    });
    expect(appended.messages).toHaveLength(2);
    expect(appended.messages[1]?.role).toBe("user");
    expect(appended.messages[1]?.content).toBe("再加审查");
    expect(appended.stateRevision).toBe(created.stateRevision + 1);
    expect(appended.messages.some((message) => message.role === "authoring_agent")).toBe(false);
    expect(store.load(created.id)?.messages).toHaveLength(2);
  });

  it("projects an unpublished draft and rejects Agent append / missing session", () => {
    const store = new InProcessAuthoringSessionStore();
    const created = store.create({ projectId: DESKTOP_LOCAL_AUTHORING_PROJECT_ID });
    const proposal = proposalDraftFromForm(filledForm());
    expect(proposal?.kind).toBe("proposal");
    expect(proposal && proposal.kind === "proposal" ? proposal.unpublished : false).toBe(true);
    const withDraft = store.attachDraft(created.id, proposal!);
    expect(withDraft.draft?.kind).toBe("proposal");

    expect(() =>
      store.appendUserMessage({
        sessionId: created.id,
        role: "authoring_agent" as "user",
        content: "假回复",
      }),
    ).toThrow();
    expect(() =>
      store.appendUserMessage({
        sessionId: "cas_missing",
        role: "user",
        content: "丢了也不要编造 Agent",
      }),
    ).toThrow(/不存在/);
    expect(store.load(created.id)?.messages).toEqual([]);
    expect(store.load("cas_missing")).toBeUndefined();
  });

  it("rehydrates the same session id and user messages from a local snapshot", () => {
    const storage = createMemoryAuthoringSessionStorage();
    const first = new InProcessAuthoringSessionStore({
      storage,
      now: () => "2026-09-12T01:00:00.000Z",
      id: (prefix) => `${prefix}reload`,
    });
    const created = first.create({ projectId: "prj_reload" });
    first.appendUserMessage({
      sessionId: created.id,
      role: "user",
      content: "reload 后还要在",
    });
    expect(storage.getItem(AUTHORING_SESSION_STORAGE_KEY)).toContain("reload 后还要在");

    const reloaded = new InProcessAuthoringSessionStore({ storage });
    const loaded = reloaded.load(created.id);
    expect(loaded?.id).toBe(created.id);
    expect(loaded?.projectId).toBe("prj_reload");
    expect(loaded?.messages.map((message) => message.content)).toEqual(["reload 后还要在"]);
    expect(loaded?.messages.every((message) => message.role === "user")).toBe(true);
    expect(reloaded.list()).toHaveLength(1);
  });

  it("skips corrupt snapshots instead of inventing an Agent success session", () => {
    const storage = createMemoryAuthoringSessionStorage({
      [AUTHORING_SESSION_STORAGE_KEY]: "{not-json",
    });
    expect(new InProcessAuthoringSessionStore({ storage }).list()).toEqual([]);

    storage.setItem(
      AUTHORING_SESSION_STORAGE_KEY,
      JSON.stringify({
        protocolVersion: "0.1",
        sessions: [
          { id: "cas_bad" },
          {
            id: "cas_ok",
            projectId: "prj_1",
            protocolVersion: "0.1",
            status: "open",
            messages: [
              {
                id: "cam_ok",
                role: "user",
                content: "有效用户消息",
                createdAt: "2026-09-12T00:00:00.000Z",
              },
            ],
            stateRevision: 1,
            createdAt: "2026-09-12T00:00:00.000Z",
            updatedAt: "2026-09-12T00:00:00.000Z",
          },
        ],
      }),
    );
    const recovered = new InProcessAuthoringSessionStore({ storage });
    expect(recovered.list().map((session) => session.id)).toEqual(["cas_ok"]);
    expect(recovered.load("cas_ok")?.messages[0]?.role).toBe("user");
    expect(
      recovered.load("cas_ok")?.messages.some((message) => message.role === "authoring_agent"),
    ).toBe(false);
  });
});

describe("landUnpublishedDraft", () => {
  it("calls M7 write APIs and never publishes", async () => {
    const createWorkflow = vi.fn(async () => fakeWorkflow());
    const createWorkflowVersion = vi.fn(async () => fakeVersion());
    const createTeam = vi.fn(async () => ({
      id: "team_1",
      name: "演示小队",
      version: "",
      status: "draft" as const,
      protocolVersion: "0.1" as const,
      roles: [],
    }));
    const publish = vi.fn();
    const client: AuthoringWriteClient & { publishWorkflowVersion: typeof publish } = {
      createWorkflow,
      createWorkflowVersion,
      createTeam,
      publishWorkflowVersion: publish,
    };
    const draft = await landUnpublishedDraft(client, filledForm());
    expect(createWorkflow).toHaveBeenCalledTimes(1);
    expect(createWorkflow).toHaveBeenCalledWith(
      { name: "功能交付", description: "项目循环草稿" },
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(createWorkflowVersion).toHaveBeenCalledTimes(1);
    expect(createWorkflowVersion).toHaveBeenCalledWith(
      "wfd_1",
      expect.objectContaining({
        entry: "step_1",
        nodes: expect.any(Array),
      }),
      expect.objectContaining({ ifMatch: 1 }),
    );
    expect(createTeam).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
    expect(draft.status).toBe("draft");
    expect(draft.unpublished).toBe(true);
    expect(draft.catalogHref).toBe("/workflows/wfd_1");
    expect(draft.canvas.available).toBe(true);
    expect(draft.canvas.href).toBe("/workflows/wfd_1/versions/wfv_1");
    expect(draft.teamId).toBe("team_1");
  });

  it("keeps the workflow draft when optional team write fails", async () => {
    const client: AuthoringWriteClient = {
      createWorkflow: async () => fakeWorkflow(),
      createWorkflowVersion: async () => fakeVersion(),
      createTeam: async () => {
        throw new Error("team write failed");
      },
    };
    const draft = await landUnpublishedDraft(client, filledForm());
    expect(draft.workflowId).toBe("wfd_1");
    expect(draft.teamId).toBeUndefined();
    expect(draft.teamWarning).toContain("team write failed");
  });

  it("does not invent a fixture draft when the write API fails", async () => {
    const client: AuthoringWriteClient = {
      createWorkflow: async () => {
        throw new Error("POST /workflows failed");
      },
      createWorkflowVersion: async () => fakeVersion(),
    };
    await expect(landUnpublishedDraft(client, filledForm())).rejects.toThrow(
      "POST /workflows failed",
    );
  });
});

describe("authoring UI", () => {
  it("renders user-append chrome without a fake Agent reply", () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowAuthoringPage, {
        params: {},
        path: "/workflows",
        navigate: () => undefined,
      }),
    );
    expect(html).toContain("workflow-authoring-page");
    expect(html).toContain("追加用户消息");
    expect(html).toContain("workflow-authoring-send-chat");
    expect(html).toContain("disabled");
    expect(html).toContain(CHAT_SESSION_GAP);
    expect(html).toContain(AGENT_REPLY_GAP);
    expect(html).toContain("还没有用户消息");
    expect(html).not.toContain("Agent 已生成");
    expect(html).not.toContain("会话已接通");
    expect(html).not.toContain("workflow-authoring-landed");
  });

  it("keeps the workflows entry honest: Agent generate disabled, local store ready", () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowAuthoringEntry, { navigate: () => undefined }),
    );
    expect(html).toContain("对话生成");
    expect(html).toContain("workflow-authoring-chat-disabled");
    expect(html).toContain("用对话生成");
    expect(html).toContain("打开作者面（用户消息 + 结构化落草稿）");
    expect(html).toContain(CHAT_SESSION_GAP);
    expect(html).toContain("workflow-authoring-chat-ready");
    expect(html).toContain("本机用户消息已接线；编排 Agent 仍 planned");
    expect(html).not.toContain("会话已接通");
    expect(html).not.toContain("Agent 已生成");
  });
});
