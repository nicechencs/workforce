export const packageName = "@workforce/desktop-client" as const;

export { createDesktopClient, DesktopClient } from "./client.js";
export type { DesktopClientOptions } from "./client.js";
export { ProblemError, isProblemDetails } from "./errors.js";
export { assertSafePath, paths } from "./paths.js";
export { createLoopbackTransport } from "./transport.js";
export type {
  ClientTransport,
  LoopbackTransportOptions,
  TransportRequest,
  TransportResponse,
} from "./transport.js";
export type {
  ApprovalDecisionInput,
  ApprovalDto,
  ArtifactDto,
  ArtifactLineageDto,
  ArtifactVersionDto,
  ArtifactVersionSummaryDto,
  CancelInput,
  CapabilitiesDto,
  CommandAcceptedDto,
  CommandOptions,
  ConfirmPlanInput,
  CreateProjectInput,
  CreateWorkspaceInput,
  EventListQuery,
  ExportBundleDto,
  HealthDto,
  ListQuery,
  NodeDto,
  OperationDto,
  PageDto,
  PatchProjectInput,
  ProblemDetails,
  ProjectBudgetDto,
  ProjectDto,
  ReadyDto,
  RunDto,
  RunInputBody,
  RuntimeCapabilitiesDto,
  RuntimeCapabilityItemDto,
  RuntimeDto,
  SessionDto,
  StartProjectInput,
  TaskDto,
  TeamDto,
  TeamRoleDto,
  VersionDto,
  WorkflowDto,
  WorkflowStepDto,
  WorkflowVersionDto,
  WorkspaceDto,
} from "./types.js";
