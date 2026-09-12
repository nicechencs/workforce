import { describe, expect, it } from "vitest";

import {
  authoringPatchRefSchema,
  parseAuthoringChatProposal,
  parseAuthoringProposalTargetInput,
  parseAuthoringLandedDraft,
  parseAuthoringSessionView,
  parseAuthoringSessionGetInput,
  parseAuthoringSessionListInput,
  parseAuthoringCommandAccepted,
  parseAuthoringTurn,
  parseAuthoringTurnActionCommand,
  parseSendAuthoringMessageInput,
} from "./authoring-chat.js";

const now = "2026-09-12T00:00:00.000Z";

describe("authoring chat protocol", () => {
  it("parses a session-bound turn with governed object references", () => {
    const turn = parseAuthoringTurn({
      id: "turn_1",
      sessionId: "cas_1",
      protocolVersion: "0.1",
      status: "running",
      userMessage: {
        id: "msg_1",
        role: "user",
        content: "创建一个带审查节点的工作流",
        createdAt: now,
      },
      refs: {
        taskId: "tsk_authoring_1",
        runId: "run_authoring_1",
        changeSetId: "acs_1",
        workflowDraftId: "wfdraft_1",
      },
      revision: 2,
      createdAt: now,
      updatedAt: now,
    });

    expect(turn.refs.workflowDraftId).toBe("wfdraft_1");
    expect(turn.userMessage.role).toBe("user");
  });

  it("keeps a landed draft identified by workflowDraftId", () => {
    expect(
      parseAuthoringLandedDraft({
        kind: "landed",
        unpublished: true,
        workflowDraftId: "wfdraft_1",
        workflowId: "wfd_1",
        revision: 2,
      }),
    ).toMatchObject({ workflowDraftId: "wfdraft_1", revision: 2 });
    expect(() =>
      parseAuthoringLandedDraft({
        kind: "landed",
        unpublished: true,
        workflowVersionId: "wfv_1",
      }),
    ).toThrow();
  });

  it("uses the chat landed-draft identity in session views", () => {
    const session = parseAuthoringSessionView({
      id: "cas_1",
      projectId: "prj_1",
      protocolVersion: "0.1",
      status: "open",
      messages: [
        {
          id: "msg_1",
          role: "user",
          content: "创建工作流",
          createdAt: now,
        },
      ],
      draft: {
        kind: "landed",
        unpublished: true,
        workflowDraftId: "wfdraft_1",
      },
      turns: [],
      stateRevision: 2,
      createdAt: now,
      updatedAt: now,
    });
    expect(
      session.draft && session.draft.kind === "landed" ? session.draft.workflowDraftId : null,
    ).toBe("wfdraft_1");
    expect(() =>
      parseAuthoringSessionView({
        id: "cas_1",
        projectId: "prj_1",
        protocolVersion: "0.1",
        status: "open",
        messages: [],
        draft: {
          kind: "landed",
          unpublished: true,
          workflowVersionId: "wfv_legacy",
        },
        turns: [],
        stateRevision: 1,
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow();
  });

  it("does not allow an agent role, raw runtime metadata, or an unbound turn", () => {
    expect(() =>
      parseAuthoringTurn({
        id: "turn_1",
        sessionId: "cas_1",
        protocolVersion: "0.1",
        status: "completed",
        userMessage: { id: "msg_1", role: "authoring_agent", content: "fake", createdAt: now },
        refs: {},
        revision: 1,
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow();
    expect(() =>
      parseAuthoringTurn({
        id: "turn_1",
        sessionId: "cas_1",
        protocolVersion: "0.1",
        status: "completed",
        userMessage: { id: "msg_1", role: "user", content: "生成", createdAt: now },
        refs: {},
        revision: 1,
        createdAt: now,
        updatedAt: now,
        transport: "local",
      }),
    ).toThrow();
  });

  it("enforces create/update proposal target rules", () => {
    expect(
      parseAuthoringProposalTargetInput({
        operation: "create",
        targetType: "workflow",
        patchRef: "arv_create_patch",
      }),
    ).toMatchObject({ operation: "create", targetType: "workflow" });
    expect(
      parseAuthoringProposalTargetInput({
        operation: "update",
        targetType: "workflow",
        targetId: "wfd_1",
        expectedRevision: 4,
        patchRef: "arv_update_patch",
      }),
    ).toMatchObject({ operation: "update", expectedRevision: 4 });
    expect(() =>
      parseAuthoringProposalTargetInput({
        operation: "create",
        targetType: "workflow",
        targetId: "wfd_1",
        patchRef: "arv_create_patch",
      }),
    ).toThrow();
    expect(() =>
      parseAuthoringProposalTargetInput({
        operation: "update",
        targetType: "workflow",
        targetId: "wfd_1",
        patchRef: "arv_update_patch",
      }),
    ).toThrow();
  });

  it("bounds patch references independently and supports a future chat proposal union", () => {
    expect(authoringPatchRefSchema.parse("x".repeat(512))).toHaveLength(512);
    expect(() => authoringPatchRefSchema.parse("x".repeat(513))).toThrow();
    const proposal = parseAuthoringChatProposal({
      id: "acp_1",
      projectId: "prj_1",
      sessionId: "cas_1",
      turnId: "turn_1",
      sourceRunId: "run_1",
      summary: "创建并更新工作流草稿",
      targets: [
        {
          operation: "create",
          targetType: "workflow",
          patchRef: "x".repeat(512),
        },
        {
          operation: "update",
          targetType: "team",
          targetId: "team_1",
          expectedRevision: 2,
          patchRef: "patch_team",
        },
      ],
    });
    expect(proposal.targets).toHaveLength(2);
    expect(() =>
      parseAuthoringChatProposal({
        ...proposal,
        targets: [
          {
            operation: "create",
            targetType: "workflow",
            patchRef: "patch_workflow",
            targetId: "must-not-be-present",
          },
        ],
      }),
    ).toThrow();

    expect(() =>
      parseAuthoringChatProposal({
        ...proposal,
        targets: [
          {
            operation: "create",
            targetType: "workflow",
            patchRef: "same-create-patch",
          },
          {
            operation: "create",
            targetType: "workflow",
            patchRef: "same-create-patch",
          },
        ],
      }),
    ).toThrow(/duplicate authoring chat proposal target/i);

    expect(() =>
      parseAuthoringChatProposal({
        ...proposal,
        targets: [
          {
            operation: "update",
            targetType: "team",
            targetId: "team_same",
            expectedRevision: 1,
            patchRef: "patch_one",
          },
          {
            operation: "update",
            targetType: "team",
            targetId: "team_same",
            expectedRevision: 2,
            patchRef: "patch_two",
          },
        ],
      }),
    ).toThrow(/duplicate authoring chat proposal target/i);
  });

  it("accepts only a user content send command", () => {
    const input = parseSendAuthoringMessageInput({
      operationId: "op_send_1",
      idempotencyKey: "idem_send_1",
      sessionId: "cas_1",
      expectedRevision: 3,
      content: "增加一个人工审批节点",
    });
    expect(input.content).toBe("增加一个人工审批节点");
    expect(() =>
      parseSendAuthoringMessageInput({
        ...input,
        role: "authoring_agent",
      }),
    ).toThrow();
    expect(() =>
      parseSendAuthoringMessageInput({
        ...input,
        placement: { executionNodeId: "node_1" },
      }),
    ).toThrow();
    expect(() =>
      parseSendAuthoringMessageInput({
        ...input,
        runtime: { adapterId: "mock", protocolVersion: "0.1" },
      }),
    ).toThrow();
  });

  it("supports session list/get and explicit turn actions", () => {
    expect(parseAuthoringSessionListInput({ projectId: "prj_1", limit: 20 })).toEqual({
      projectId: "prj_1",
      limit: 20,
    });
    expect(parseAuthoringSessionGetInput({ sessionId: "cas_1" })).toEqual({
      sessionId: "cas_1",
    });
    expect(
      parseAuthoringTurnActionCommand({
        action: "confirm",
        operationId: "op_confirm_1",
        idempotencyKey: "idem_confirm_1",
        sessionId: "cas_1",
        turnId: "turn_1",
        expectedRevision: 2,
      }),
    ).toMatchObject({ action: "confirm", turnId: "turn_1" });
    expect(() =>
      parseAuthoringTurnActionCommand({
        action: "delete",
        operationId: "op_delete_1",
        idempotencyKey: "idem_delete_1",
        sessionId: "cas_1",
        turnId: "turn_1",
        expectedRevision: 2,
      }),
    ).toThrow();
    const accepted = parseAuthoringCommandAccepted({
      operationId: "op_send_1",
      acceptedAt: now,
      sessionId: "cas_1",
      turnId: "turn_1",
      revision: 2,
    });
    expect(accepted.turnId).toBe("turn_1");
    expect(() =>
      parseAuthoringCommandAccepted({
        ...accepted,
        transport: "local",
      }),
    ).toThrow();
    expect(() =>
      parseAuthoringCommandAccepted({
        ...accepted,
        runtime: { adapterId: "mock" },
      }),
    ).toThrow();
    expect(() =>
      parseAuthoringCommandAccepted({
        ...accepted,
        content: "原始用户输入不得进入 accepted response",
      }),
    ).toThrow();
  });
});
