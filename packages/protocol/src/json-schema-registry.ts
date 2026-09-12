import type { ZodTypeAny } from "zod";

import {
  authoringChangeSetSchema,
  authoringProposalSchema,
  authoringSessionSchema,
  workflowDraftSchema,
} from "./authoring.js";
import {
  authoringCommandAcceptedSchema,
  authoringChatProposalSchema,
  authoringLandedDraftSchema,
  authoringProposalTargetInputSchema,
  authoringSessionGetInputSchema,
  authoringSessionListInputSchema,
  authoringSessionPageSchema,
  authoringSessionViewSchema,
  authoringTurnActionAcceptedSchema,
  authoringTurnActionCommandSchema,
  authoringTurnSchema,
  createAuthoringSessionAcceptedSchema,
  createAuthoringSessionCommandSchema,
  sendAuthoringMessageAcceptedSchema,
  sendAuthoringMessageInputSchema,
} from "./authoring-chat.js";
import { runDtoSchema } from "./dto.js";
import { workforceEventSchema } from "./event.js";
import { orchestrationModeSchema } from "./execution.js";
import { projectExecutionSnapshotSchema } from "./execution-snapshot.js";
import { expectedOutputSchema } from "./expected-output.js";
import { moneySchema } from "./money.js";
import { taskDtoSchema } from "./task.js";
import { teamSchema } from "./team.js";
import { workflowGraphDefinitionSchema, workflowSchema } from "./workflow.js";

/**
 * The intentionally small V0.1 JSON-Schema publication surface. Do not add
 * internal helper schemas here merely because they happen to be exported by a
 * TypeScript module: every registry entry is a versioned cross-language
 * contract and produces one checked-in document.
 */
export interface ProtocolJsonSchemaDefinition {
  fileName: string;
  title: string;
  schema: ZodTypeAny;
}

export const protocolJsonSchemaRegistry: readonly ProtocolJsonSchemaDefinition[] = [
  {
    fileName: "authoring-command-accepted.schema.json",
    title: "AuthoringCommandAccepted",
    schema: authoringCommandAcceptedSchema,
  },
  {
    fileName: "authoring-chat-proposal.schema.json",
    title: "AuthoringChatProposal",
    schema: authoringChatProposalSchema,
  },
  {
    fileName: "authoring-landed-draft.schema.json",
    title: "AuthoringLandedDraft",
    schema: authoringLandedDraftSchema,
  },
  {
    fileName: "authoring-change-set.schema.json",
    title: "AuthoringChangeSet",
    schema: authoringChangeSetSchema,
  },
  {
    fileName: "authoring-proposal.schema.json",
    title: "AuthoringProposal",
    schema: authoringProposalSchema,
  },
  {
    fileName: "authoring-session.schema.json",
    title: "AuthoringSession",
    schema: authoringSessionSchema,
  },
  {
    fileName: "authoring-session-get-input.schema.json",
    title: "AuthoringSessionGetInput",
    schema: authoringSessionGetInputSchema,
  },
  {
    fileName: "authoring-session-list-input.schema.json",
    title: "AuthoringSessionListInput",
    schema: authoringSessionListInputSchema,
  },
  {
    fileName: "authoring-session-page.schema.json",
    title: "AuthoringSessionPage",
    schema: authoringSessionPageSchema,
  },
  {
    fileName: "authoring-session-view.schema.json",
    title: "AuthoringSessionView",
    schema: authoringSessionViewSchema,
  },
  {
    fileName: "authoring-turn.schema.json",
    title: "AuthoringTurn",
    schema: authoringTurnSchema,
  },
  {
    fileName: "authoring-turn-action-accepted.schema.json",
    title: "AuthoringTurnActionAccepted",
    schema: authoringTurnActionAcceptedSchema,
  },
  {
    fileName: "authoring-turn-action-command.schema.json",
    title: "AuthoringTurnActionCommand",
    schema: authoringTurnActionCommandSchema,
  },
  {
    fileName: "authoring-proposal-target-input.schema.json",
    title: "AuthoringProposalTargetInput",
    schema: authoringProposalTargetInputSchema,
  },
  {
    fileName: "authoring-session-create-command.schema.json",
    title: "CreateAuthoringSessionCommand",
    schema: createAuthoringSessionCommandSchema,
  },
  {
    fileName: "authoring-session-create-accepted.schema.json",
    title: "CreateAuthoringSessionAccepted",
    schema: createAuthoringSessionAcceptedSchema,
  },
  {
    fileName: "authoring-message-send-input.schema.json",
    title: "SendAuthoringMessageInput",
    schema: sendAuthoringMessageInputSchema,
  },
  {
    fileName: "authoring-message-send-accepted.schema.json",
    title: "SendAuthoringMessageAccepted",
    schema: sendAuthoringMessageAcceptedSchema,
  },
  {
    fileName: "event-envelope.schema.json",
    title: "WorkforceEvent",
    schema: workforceEventSchema,
  },
  {
    fileName: "expected-output.schema.json",
    title: "ExpectedOutput",
    schema: expectedOutputSchema,
  },
  { fileName: "money.schema.json", title: "Money", schema: moneySchema },
  {
    fileName: "orchestration-mode.schema.json",
    title: "OrchestrationMode",
    schema: orchestrationModeSchema,
  },
  {
    fileName: "project-execution-snapshot.schema.json",
    title: "ProjectExecutionSnapshot",
    schema: projectExecutionSnapshotSchema,
  },
  { fileName: "run.schema.json", title: "RunDto", schema: runDtoSchema },
  { fileName: "task.schema.json", title: "TaskDto", schema: taskDtoSchema },
  { fileName: "team.schema.json", title: "Team", schema: teamSchema },
  {
    fileName: "workflow-draft.schema.json",
    title: "WorkflowDraft",
    schema: workflowDraftSchema,
  },
  {
    fileName: "workflow-graph-definition.schema.json",
    title: "WorkflowGraphDefinition",
    schema: workflowGraphDefinitionSchema,
  },
  { fileName: "workflow-catalog.schema.json", title: "Workflow", schema: workflowSchema },
] as const;
