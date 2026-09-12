import type { ZodTypeAny } from "zod";

import {
  authoringChangeSetSchema,
  authoringProposalSchema,
  authoringSessionSchema,
  workflowDraftSchema,
} from "./authoring.js";
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
