import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  isUnpublishedAuthoringDraft,
  parseAppendAuthoringSessionMessageInput,
  parseAuthoringDraft,
  parseAuthoringChangeSet,
  parseAuthoringProposal,
  parseAuthoringSession,
  parseCreateAuthoringSessionInput,
  parseWorkflowDraft,
} from "./authoring.js";

const fixtures = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/protocols/v0.1/fixtures",
);

function openSessionFixture(): unknown {
  return JSON.parse(readFileSync(resolve(fixtures, "authoring.session.open.json"), "utf8"));
}

describe("D17 authoring session / draft DTO", () => {
  it("parses the open session fixture with a user turn and proposal draft", () => {
    const session = parseAuthoringSession(openSessionFixture());
    expect(session.id).toMatch(/^cas_/);
    expect(session.projectId).toMatch(/^prj_/);
    expect(session.protocolVersion).toBe("0.1");
    expect(session.status).toBe("open");
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0]?.role).toBe("user");
    expect(session.draft?.kind).toBe("proposal");
    expect(session.draft && isUnpublishedAuthoringDraft(session.draft)).toBe(true);
    expect(session.draft?.kind === "proposal" ? session.draft.workflow?.name : undefined).toBe(
      "功能交付草稿",
    );
  });

  it("accepts a landed unpublished draft that reuses M7 write refs", () => {
    const draft = parseAuthoringDraft({
      kind: "landed",
      unpublished: true,
      workflowId: "wfd_1",
      workflowVersionId: "wfv_1",
      teamId: "tm_1",
    });
    expect(draft.kind).toBe("landed");
    expect(isUnpublishedAuthoringDraft(draft)).toBe(true);
    const session = parseAuthoringSession({
      id: "cas_landed",
      projectId: "prj_1",
      protocolVersion: "0.1",
      status: "open",
      messages: [
        {
          id: "cam_1",
          role: "user",
          content: "把刚才的草稿落库",
          createdAt: "2026-09-12T00:00:00.000Z",
        },
      ],
      draft,
      stateRevision: 2,
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-12T00:01:00.000Z",
    });
    expect(session.draft).toEqual(draft);
  });

  it("accepts reserved authoring_agent role without treating it as Task or Run completion", () => {
    const session = parseAuthoringSession({
      id: "cas_agent_role",
      projectId: "prj_1",
      protocolVersion: "0.1",
      status: "failed",
      messages: [
        {
          id: "cam_user",
          role: "user",
          content: "生成工作流",
          createdAt: "2026-09-12T00:00:00.000Z",
        },
        {
          id: "cam_system",
          role: "system",
          content: "编排 Agent 尚未接线；本条不是生成成功。",
          createdAt: "2026-09-12T00:00:01.000Z",
        },
        {
          id: "cam_agent",
          role: "authoring_agent",
          content: "角色已预留，本 PR 不产生假回复。",
          createdAt: "2026-09-12T00:00:02.000Z",
        },
      ],
      stateRevision: 1,
      createdAt: "2026-09-12T00:00:00.000Z",
      updatedAt: "2026-09-12T00:00:02.000Z",
    });
    expect(session.status).toBe("failed");
    expect(session.draft).toBeUndefined();
    expect(session.messages.map((message) => message.role)).toEqual([
      "user",
      "system",
      "authoring_agent",
    ]);
    expect(session).not.toHaveProperty("taskId");
    expect(session).not.toHaveProperty("runId");
  });

  it("parses create and user-only append inputs", () => {
    expect(parseCreateAuthoringSessionInput({ projectId: "prj_1" })).toEqual({
      projectId: "prj_1",
    });
    expect(
      parseCreateAuthoringSessionInput({
        projectId: "prj_1",
        intentText: " 创建 bot1 跑流程 X ",
      }).intentText,
    ).toBe("创建 bot1 跑流程 X");
    expect(
      parseAppendAuthoringSessionMessageInput({
        sessionId: "cas_1",
        role: "user",
        content: " 补充一步审查 ",
      }),
    ).toEqual({
      sessionId: "cas_1",
      role: "user",
      content: "补充一步审查",
    });
  });

  it("rejects published drafts, Runtime fields, and the old executionMode name", () => {
    expect(() =>
      parseAuthoringDraft({
        kind: "landed",
        unpublished: false,
        workflowId: "wfd_1",
        workflowVersionId: "wfv_1",
      }),
    ).toThrow();
    expect(() =>
      parseAuthoringDraft({
        kind: "proposal",
        unpublished: true,
        status: "published",
        workflow: { name: "Locked" },
      }),
    ).toThrow();
    expect(() =>
      parseAuthoringSession({
        ...(openSessionFixture() as Record<string, unknown>),
        executionMode: "direct",
      }),
    ).toThrow();
    expect(() =>
      parseAuthoringSession({
        ...(openSessionFixture() as Record<string, unknown>),
        orchestrationMode: "direct",
      }),
    ).toThrow();
    expect(() =>
      parseAuthoringSession({
        ...(openSessionFixture() as Record<string, unknown>),
        runId: "run_1",
        taskId: "tsk_1",
      }),
    ).toThrow();
  });

  it("rejects empty content, empty proposal, and non-user append", () => {
    expect(() =>
      parseCreateAuthoringSessionInput({ projectId: "prj_1", intentText: "   " }),
    ).toThrow();
    expect(() =>
      parseAppendAuthoringSessionMessageInput({
        sessionId: "cas_1",
        role: "authoring_agent",
        content: "假回复",
      }),
    ).toThrow();
    expect(() =>
      parseAppendAuthoringSessionMessageInput({
        sessionId: "cas_1",
        role: "user",
        content: "   ",
      }),
    ).toThrow();
    expect(() =>
      parseAuthoringDraft({
        kind: "proposal",
        unpublished: true,
      }),
    ).toThrow(/proposal draft needs workflow or team/);
    expect(() => parseAuthoringSessionMessageLikeEmpty()).toThrow();
  });
});

describe("D17 proposal, change-set, and canonical drafts", () => {
  const createdAt = "2026-09-12T00:00:00.000Z";
  const target = {
    targetType: "workflow" as const,
    targetId: "wfd_1",
    expectedRevision: 3,
    patchRef: "arv_proposal_patch",
  };

  it("parses a structured proposal and a draft without exposing raw prompt material", () => {
    expect(
      parseAuthoringProposal({
        id: "apr_1",
        projectId: "prj_1",
        sourceRunId: "run_1",
        summary: "Add an approval gate after implementation.",
        targets: [target],
      }),
    ).toMatchObject({ id: "apr_1", targets: [target] });
    expect(() =>
      parseAuthoringProposal({
        id: "apr_1",
        projectId: "prj_1",
        sourceRunId: "run_1",
        summary: "safe summary",
        targets: [target],
        rawPrompt: "secret should never enter the structured proposal",
      }),
    ).toThrow();

    expect(
      parseWorkflowDraft({
        id: "wfdraft_1",
        workflowId: "wfd_1",
        revision: 3,
        status: "draft",
        graph: {
          entryNodeIds: ["plan"],
          nodes: [{ id: "plan", kind: "task", role: "planner" }],
          edges: [],
          failurePolicy: { default: "fail" },
          concurrencyPolicy: { runWorktree: "isolated", integrationWorktree: "dedicated" },
        },
        contentHash: "sha256:graph",
        updatedAt: createdAt,
        updatedBy: "usr_1",
      }),
    ).toMatchObject({ status: "draft", revision: 3 });
  });

  it("requires uniquely ordered, individually CAS-bound change-set steps", () => {
    const changeSet = {
      id: "acs_1",
      organizationId: "org_1",
      projectId: "prj_1",
      workflowId: "wfd_1",
      sourceRunId: "run_1",
      status: "proposed" as const,
      proposalRef: "arv_proposal",
      steps: [{ id: "acst_1", ordinal: 1, ...target, status: "pending" as const }],
      createdAt,
      updatedAt: createdAt,
    };
    expect(parseAuthoringChangeSet(changeSet).steps[0]?.expectedRevision).toBe(3);
    expect(() =>
      parseAuthoringChangeSet({
        ...changeSet,
        steps: [...changeSet.steps, { id: "acst_2", ordinal: 1, ...target, status: "pending" }],
      }),
    ).toThrow(/duplicate authoring change-set/i);
  });
});

function parseAuthoringSessionMessageLikeEmpty(): void {
  parseAuthoringSession({
    id: "cas_empty",
    projectId: "prj_1",
    protocolVersion: "0.1",
    status: "open",
    messages: [
      {
        id: "cam_empty",
        role: "user",
        content: "   ",
        createdAt: "2026-09-12T00:00:00.000Z",
      },
    ],
    stateRevision: 1,
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
  });
}
