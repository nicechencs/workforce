import {
  CatalogService,
  MemoryCatalog,
  UseCaseError,
  isBindableTeamVersion,
  teamDtoFromCatalog,
  workerDtoFromCatalog,
  workflowDtoFromCatalog,
  workflowVersionDto,
  teamVersionDto,
  type CatalogServiceOptions,
} from "@workforce/application";
import {
  parseChatClassifyInput,
  parseChatClassifyResult,
  type ChatClassifyInput,
  type ChatClassifyResultDto,
  type ChatIntentDto,
  type ListWorkersInput,
  type TeamDto,
  type TeamVersionDto,
  type WorkerDraftDto,
  type WorkerDto,
  type WorkerPageDto,
  type WorkerVersionDto,
  type WorkerVersionReferencesDto,
  type WorkflowDto,
  type WorkflowVersionDto,
} from "@workforce/protocol";

import {
  FEATURE_DELIVERY_WORKFLOW,
  SOFTWARE_TEAM,
  SOFTWARE_TEAM_VERSION,
  TEAM_ID,
  TEAM_VERSION_ID,
  findPublishedTeam,
  findPublishedTeamVersion,
  findPublishedWorker,
  findPublishedWorkerVersion,
  findPublishedWorkflow,
  findPublishedWorkflowVersion,
  isPresetPublishedTeamVersion,
  seedPresetWorkerLibrary,
} from "../composition/catalog.js";

export function createAuthoringCatalog(options: Omit<CatalogServiceOptions, "catalog">): {
  store: MemoryCatalog;
  service: CatalogService;
} {
  const store = new MemoryCatalog();
  seedPresetWorkerLibrary(store);
  return { store, service: new CatalogService({ ...options, catalog: store }) };
}

export function listedWorkflows(service: CatalogService): WorkflowDto[] {
  const custom = service
    .listPublishedWorkflows()
    .map((record) => workflowDtoFromCatalog(service.catalog, record));
  return [FEATURE_DELIVERY_WORKFLOW, ...custom];
}

export function resolveWorkflow(service: CatalogService, id: string): WorkflowDto | null {
  const seeded = findPublishedWorkflow(id);
  if (seeded) {
    return seeded;
  }
  const record = service.getWorkflow(id);
  return record ? workflowDtoFromCatalog(service.catalog, record) : null;
}

export function resolveWorkflowVersion(
  service: CatalogService,
  id: string,
  versionId: string,
): WorkflowVersionDto | null {
  const seeded = findPublishedWorkflowVersion(id, versionId);
  if (seeded) {
    return seeded;
  }
  const record = service.getWorkflowVersion(id, versionId);
  return record ? workflowVersionDto(record) : null;
}

export function listedTeams(service: CatalogService): TeamDto[] {
  const custom = service
    .listPublishedTeams()
    .map((record) => teamDtoFromCatalog(service.catalog, record));
  return [SOFTWARE_TEAM, ...custom];
}

export function listedDraftTeams(service: CatalogService): TeamDto[] {
  return service.catalog
    .listTeams()
    .filter((item) => item.status === "draft")
    .map((record) => teamDtoFromCatalog(service.catalog, record));
}

export function resolveTeam(service: CatalogService, id: string): TeamDto | null {
  const seeded = findPublishedTeam(id);
  if (seeded) {
    return seeded;
  }
  const record = service.getTeam(id);
  return record ? teamDtoFromCatalog(service.catalog, record) : null;
}

export function resolveTeamVersion(
  service: CatalogService,
  id: string,
  versionId: string,
): TeamVersionDto | null {
  const seeded = findPublishedTeamVersion(id, versionId);
  if (seeded) {
    return seeded;
  }
  const record = service.getTeamVersion(id, versionId);
  return record ? teamVersionDto(record) : null;
}

export function listedWorkers(
  service: CatalogService,
  input: ListWorkersInput = {},
): WorkerPageDto {
  return service.listWorkers(input);
}

export function resolveWorker(service: CatalogService, id: string): WorkerDto | null {
  const seeded = findPublishedWorker(id);
  if (seeded) {
    return seeded;
  }
  const record = service.getWorker(id);
  return record ? workerDtoFromCatalog(service.catalog, record) : null;
}

export function resolveWorkerVersion(
  service: CatalogService,
  id: string,
  versionId: string,
): WorkerVersionDto | null {
  const seeded = findPublishedWorkerVersion(id, versionId);
  if (seeded) {
    return seeded;
  }
  return service.getWorkerVersion(id, versionId) ?? null;
}

export function resolveWorkerDraft(
  service: CatalogService,
  workerId: string,
  draftId: string,
): WorkerDraftDto | null {
  return service.getWorkerDraft(workerId, draftId) ?? null;
}

export function resolveWorkerVersionReferences(
  service: CatalogService,
  workerId: string,
  versionId: string,
): WorkerVersionReferencesDto | null {
  const version = resolveWorkerVersion(service, workerId, versionId);
  if (!version) {
    return null;
  }
  const fromCatalog = service.listWorkerVersionReferences(workerId, version.id);
  const presetHit = SOFTWARE_TEAM_VERSION.members.some(
    (member) => member.workerVersionId === version.id,
  );
  if (!presetHit) {
    return fromCatalog;
  }
  const seen = new Set(fromCatalog.teamVersions.map((item) => item.teamVersionId));
  if (seen.has(TEAM_VERSION_ID)) {
    return fromCatalog;
  }
  return {
    workerVersionId: version.id,
    teamVersions: [
      ...fromCatalog.teamVersions,
      { teamId: TEAM_ID, teamVersionId: TEAM_VERSION_ID, status: "published" },
    ],
  };
}

export function assertBindableTeamVersionId(service: CatalogService, versionId: string): void {
  if (isPresetPublishedTeamVersion(versionId)) {
    if (
      !isBindableTeamVersion(SOFTWARE_TEAM_VERSION, (id) => service.catalog.findWorkerVersion(id))
    ) {
      throw new UseCaseError(
        "invalid_transition",
        "TeamVersion cannot bind or start planning unless it is published and every member references a published workerVersionId",
      );
    }
    return;
  }
  service.assertBindableTeamVersion(versionId);
}

/**
 * Chat language-entry classification. Does not persist, does not open an IM
 * inbox, and does not treat the result as completion.
 */
export function classifyChatIntent(input: ChatClassifyInput): ChatClassifyResultDto {
  const parsed = parseChatClassifyInput(input);
  const text = parsed.text;
  const lowered = text.toLowerCase();

  if (isImRequest(lowered, text)) {
    return parseChatClassifyResult({
      outcome: "unsupported",
      code: "unsupported_capability",
      action: "im",
    });
  }
  if (isDirectRequest(lowered, text)) {
    return parseChatClassifyResult({
      outcome: "unsupported",
      code: "unsupported_capability",
      action: "direct",
    });
  }

  const kind = detectChatIntentKind(lowered, text);
  if (kind === "create_worker") {
    const intent: ChatIntentDto = { kind: "create_worker" };
    if (parsed.projectId !== undefined) {
      intent.projectId = parsed.projectId;
    }
    const summary = text.trim();
    if (summary.length > 0) {
      intent.summary = summary;
    }
    return parseChatClassifyResult({ outcome: "intent", intent });
  }
  if (kind === "create_workflow") {
    if (parsed.projectId === undefined) {
      return parseChatClassifyResult({ outcome: "need_context", missing: "projectId" });
    }
    const intent: ChatIntentDto = { kind: "create_workflow", projectId: parsed.projectId };
    const summary = text.trim();
    if (summary.length > 0) {
      intent.summary = summary;
    }
    return parseChatClassifyResult({ outcome: "intent", intent });
  }
  if (kind === "query_progress") {
    if (parsed.projectId === undefined) {
      return parseChatClassifyResult({ outcome: "need_context", missing: "projectId" });
    }
    return parseChatClassifyResult({
      outcome: "intent",
      intent: { kind: "query_progress", projectId: parsed.projectId },
    });
  }

  if (parsed.projectId === undefined) {
    return parseChatClassifyResult({ outcome: "need_context", missing: "projectId" });
  }
  if (needsRunId(lowered, text) && parsed.runId === undefined) {
    return parseChatClassifyResult({ outcome: "need_context", missing: "runId" });
  }
  const intent: ChatIntentDto = { kind: "discuss_work", projectId: parsed.projectId };
  if (parsed.runId !== undefined) {
    intent.runId = parsed.runId;
  }
  return parseChatClassifyResult({ outcome: "intent", intent });
}

function isImRequest(lowered: string, text: string): boolean {
  return (
    /收件箱|私聊|inbox/.test(lowered) ||
    /\/chat\/inbox/.test(text) ||
    /\/workers\/[^/\s]+\/messages/.test(text)
  );
}

function isDirectRequest(lowered: string, text: string): boolean {
  return /去做|现在改|马上做|\bdirect\b|just do it/.test(lowered) || /:direct/.test(text);
}

function detectChatIntentKind(lowered: string, text: string): ChatIntentDto["kind"] | undefined {
  void text;
  if (/进度|还没有记录|\bprogress\b/.test(lowered)) {
    return "query_progress";
  }
  if (/创建角色|创建员工|新角色|角色版本|create worker/.test(lowered)) {
    return "create_worker";
  }
  if (/创建流程|创建工作流|create workflow/.test(lowered)) {
    return "create_workflow";
  }
  if (/交流|讨论|返工|补约束|工作内容|\bdiscuss\b/.test(lowered)) {
    return "discuss_work";
  }
  return undefined;
}

function needsRunId(lowered: string, text: string): boolean {
  void text;
  return /执行中|进行中|这条 run|this run|\brunid\b/.test(lowered);
}
