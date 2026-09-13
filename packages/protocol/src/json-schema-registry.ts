import type { ZodTypeAny } from "zod";

import {
  authoringChangeSetSchema,
  authoringProposalSchema,
  authoringSessionSchema,
  teamDraftSchema,
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
import {
  chatClassifyInputSchema,
  chatClassifyResultDtoSchema,
  chatIntentDtoSchema,
  projectProgressProjectionDtoSchema,
} from "./chat-intent.js";
import {
  startDirectTaskRunAcceptedSchema,
  startDirectTaskRunInputSchema,
} from "./direct-execution.js";
import { projectDtoSchema, runDtoSchema } from "./dto.js";
import { workforceEventSchema } from "./event.js";
import { orchestrationModeSchema } from "./execution.js";
import { projectExecutionSnapshotSchema } from "./execution-snapshot.js";
import { expectedOutputSchema } from "./expected-output.js";
import { moneySchema } from "./money.js";
import { taskDtoSchema } from "./task.js";
import { teamSchema } from "./team.js";
import {
  createWorkerInputSchema,
  forkWorkerVersionAcceptedDtoSchema,
  workerCardFieldsDtoSchema,
  workerDraftDtoSchema,
  workerDraftWriteSchema,
  workerDtoSchema,
  workerPageDtoSchema,
  workerVersionDtoSchema,
  workerVersionReferencesDtoSchema,
} from "./worker.js";
import { workflowGraphDefinitionSchema, workflowSchema } from "./workflow.js";

/**
 * The V0.1 JSON Schema / OpenAPI publication surface. Do not add internal
 * helper schemas merely because a TypeScript module exports them: every
 * registry entry is a versioned cross-language contract and produces one
 * checked-in JSON Schema plus one OpenAPI `components.schemas` component.
 *
 * A new public DTO must be registered here before it is a published contract.
 * `export const *DtoSchema` bindings are additionally fail-closed by the
 * schema generator: missing entries make `protocol:schema:generate/check`
 * fail so "code has it, schema does not" cannot land again.
 */
export interface ProtocolJsonSchemaDefinition {
  fileName: string;
  title: string;
  schema: ZodTypeAny;
}

export const PROTOCOL_OPENAPI_FILE_NAME = "openapi.json" as const;
export const PROTOCOL_OPENAPI_VERSION = "3.1.0" as const;
export const PROTOCOL_JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema" as const;

export const protocolJsonSchemaRegistry: readonly ProtocolJsonSchemaDefinition[] = [
  {
    fileName: "authoring-command-accepted.schema.json",
    title: "AuthoringCommandAccepted",
    schema: authoringCommandAcceptedSchema,
  },
  {
    fileName: "chat-classify-input.schema.json",
    title: "ChatClassifyInput",
    schema: chatClassifyInputSchema,
  },
  {
    fileName: "chat-classify-result.schema.json",
    title: "ChatClassifyResultDto",
    schema: chatClassifyResultDtoSchema,
  },
  {
    fileName: "chat-intent.schema.json",
    title: "ChatIntentDto",
    schema: chatIntentDtoSchema,
  },
  {
    fileName: "create-worker-input.schema.json",
    title: "CreateWorkerInput",
    schema: createWorkerInputSchema,
  },
  {
    fileName: "fork-worker-version-accepted.schema.json",
    title: "ForkWorkerVersionAcceptedDto",
    schema: forkWorkerVersionAcceptedDtoSchema,
  },
  {
    fileName: "project-progress-projection.schema.json",
    title: "ProjectProgressProjectionDto",
    schema: projectProgressProjectionDtoSchema,
  },
  {
    fileName: "worker.schema.json",
    title: "WorkerDto",
    schema: workerDtoSchema,
  },
  {
    fileName: "worker-card-fields.schema.json",
    title: "WorkerCardFieldsDto",
    schema: workerCardFieldsDtoSchema,
  },
  {
    fileName: "worker-draft.schema.json",
    title: "WorkerDraftDto",
    schema: workerDraftDtoSchema,
  },
  {
    fileName: "worker-draft-write.schema.json",
    title: "WorkerDraftWrite",
    schema: workerDraftWriteSchema,
  },
  {
    fileName: "worker-page.schema.json",
    title: "WorkerPageDto",
    schema: workerPageDtoSchema,
  },
  {
    fileName: "worker-version.schema.json",
    title: "WorkerVersionDto",
    schema: workerVersionDtoSchema,
  },
  {
    fileName: "worker-version-references.schema.json",
    title: "WorkerVersionReferencesDto",
    schema: workerVersionReferencesDtoSchema,
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
    fileName: "direct-task-run-start-input.schema.json",
    title: "StartDirectTaskRunInput",
    schema: startDirectTaskRunInputSchema,
  },
  {
    fileName: "direct-task-run-start-accepted.schema.json",
    title: "StartDirectTaskRunAccepted",
    schema: startDirectTaskRunAcceptedSchema,
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
  { fileName: "project.schema.json", title: "ProjectDto", schema: projectDtoSchema },
  { fileName: "run.schema.json", title: "RunDto", schema: runDtoSchema },
  { fileName: "task.schema.json", title: "TaskDto", schema: taskDtoSchema },
  { fileName: "team.schema.json", title: "Team", schema: teamSchema },
  {
    fileName: "team-draft.schema.json",
    title: "TeamDraft",
    schema: teamDraftSchema,
  },
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

function duplicateKeys(
  entries: readonly ProtocolJsonSchemaDefinition[],
  key: "fileName" | "title",
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of entries) {
    const value = entry[key];
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

/**
 * Fail closed when the publication catalog is internally inconsistent.
 * Called by the schema generator before writing or checking artifacts.
 */
export function assertProtocolRegistryInvariants(
  entries: readonly ProtocolJsonSchemaDefinition[] = protocolJsonSchemaRegistry,
): void {
  const duplicateFiles = duplicateKeys(entries, "fileName");
  const duplicateTitles = duplicateKeys(entries, "title");
  if (duplicateFiles.length > 0 || duplicateTitles.length > 0) {
    const details = [
      duplicateFiles.length > 0 ? `fileName: ${duplicateFiles.join(", ")}` : "",
      duplicateTitles.length > 0 ? `title: ${duplicateTitles.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    throw new Error(`Protocol JSON Schema registry has duplicate keys (${details}).`);
  }
}

const DTO_SCHEMA_EXPORT_SUFFIX = "DtoSchema" as const;

/** `projectDtoSchema` → `ProjectDto`. */
export function protocolDtoSchemaExportTitle(exportName: string): string {
  if (!exportName.endsWith(DTO_SCHEMA_EXPORT_SUFFIX)) {
    throw new Error(`Expected a *DtoSchema export name, received: ${exportName}`);
  }
  const withoutSuffix = exportName.slice(0, -"Schema".length);
  return `${withoutSuffix.charAt(0).toUpperCase()}${withoutSuffix.slice(1)}`;
}

/**
 * Every `export const *DtoSchema` public DTO must appear in the registry
 * under the derived title (`projectDtoSchema` → `ProjectDto`).
 */
export function assertPublicDtoSchemasRegistered(
  exportedDtoSchemas: Readonly<Record<string, ZodTypeAny>>,
  entries: readonly ProtocolJsonSchemaDefinition[] = protocolJsonSchemaRegistry,
): void {
  const missing: string[] = [];
  for (const [exportName, schema] of Object.entries(exportedDtoSchemas)) {
    const title = protocolDtoSchemaExportTitle(exportName);
    const registered = entries.some((entry) => entry.title === title && entry.schema === schema);
    if (!registered) missing.push(`${exportName} (title ${title})`);
  }
  if (missing.length > 0) {
    throw new Error(
      `Public DTO schema is not in protocolJsonSchemaRegistry: ${missing.join(", ")}. Register it before publishing.`,
    );
  }
}
