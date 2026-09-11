import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { loadFeatureModules } from "../../app/feature-modules.js";
import { WorkflowAuthoringEntry } from "./entry.js";
import * as authoringModule from "./index.js";
import {
  AUTHORING_ROUTE_GAP,
  CHAT_SESSION_GAP,
  CHAT_SESSION_PROTOCOL_FROZEN,
  buildDraftGraph,
  canvasEditLink,
  emptyAuthoringModel,
  isWorkflowAuthoringHash,
  landUnpublishedDraft,
  parseStructuredIntent,
  reduceAuthoring,
  rejectChatSubmit,
  type AuthoringWriteClient,
  type LandedDraft,
} from "./model.js";
import { WorkflowAuthoringPage } from "./page.js";

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
  it("does not freeze or enable chat session protocol", () => {
    expect(CHAT_SESSION_PROTOCOL_FROZEN).toBe(false);
    const model = emptyAuthoringModel();
    expect(model.chat.enabled).toBe(false);
    expect(model.chat.submitEnabled).toBe(false);
    expect(model.chat.messages).toEqual([]);
    expect(model.chat.explanation).toBe(CHAT_SESSION_GAP);
    expect(model.routeGap).toBe(AUTHORING_ROUTE_GAP);
    expect(rejectChatSubmit().ok).toBe(false);
    expect(canvasEditLink("wfd_1", "wfv_1").available).toBe(true);
    expect(canvasEditLink("wfd_1", "wfv_1").href).toBe("/workflows/wfd_1/versions/wfv_1");
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
    expect(parsed.reason).toContain("会话协议未冻结");
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
  it("keeps typed fields after empty intent, validation, chat reject, and write failure", () => {
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
    expect(chat.error).toBe(CHAT_SESSION_GAP);
    expect(chat.form.intentText).toBe("请生成");
    expect(chat.chat.messages).toEqual([]);

    const failed = reduceAuthoring(
      reduceAuthoring(emptyAuthoringModel(), { type: "change", field: "name", value: "保留我" }),
      { type: "failure", error: new Error("daemon rejected create") },
    );
    expect(failed.phase).toBe("failed");
    expect(failed.form.name).toBe("保留我");
    expect(failed.draft).toBeNull();
    expect(failed.error).toContain("daemon rejected create");
  });

  it("records a landed draft without turning chat into a success thread", () => {
    const draft: LandedDraft = {
      workflowId: "wfd_1",
      workflowName: "功能交付",
      versionId: "wfv_1",
      status: "draft",
      unpublished: true,
      catalogHref: "/workflows/wfd_1",
      canvas: canvasEditLink("wfd_1", "wfv_1"),
    };
    const landed = reduceAuthoring(
      reduceAuthoring(emptyAuthoringModel(), { type: "change", field: "name", value: "功能交付" }),
      { type: "landed", draft },
    );
    expect(landed.phase).toBe("landed");
    expect(landed.form.name).toBe("功能交付");
    expect(landed.chat.messages).toEqual([]);
    expect(landed.chat.submitEnabled).toBe(false);
    expect(landed.draft?.unpublished).toBe(true);
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
  it("renders a disabled chat path and no fake Agent reply", () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowAuthoringPage, {
        params: {},
        path: "/workflows",
        navigate: () => undefined,
      }),
    );
    expect(html).toContain("workflow-authoring-page");
    expect(html).toContain("发送给编排 Agent");
    expect(html).toContain("workflow-authoring-send-chat");
    expect(html).toContain("disabled");
    expect(html).toContain(CHAT_SESSION_GAP);
    expect(html).toContain("没有 Agent 回复");
    expect(html).not.toContain("Agent 已生成");
    expect(html).not.toContain("会话已接通");
    expect(html).not.toContain("workflow-authoring-landed");
  });

  it("keeps the workflows entry honest: disabled chat, openable authoring shell", () => {
    const html = renderToStaticMarkup(
      createElement(WorkflowAuthoringEntry, { navigate: () => undefined }),
    );
    expect(html).toContain("对话生成");
    expect(html).toContain("workflow-authoring-chat-disabled");
    expect(html).toContain("用对话生成");
    expect(html).toContain("打开作者面（结构化落草稿）");
    expect(html).toContain(CHAT_SESSION_GAP);
    expect(html).not.toContain("会话已接通");
    expect(html).not.toContain("Agent 已生成");
    expect(html).not.toContain("workflow-authoring-chat-ready");
  });
});
