import {
  entryNodeIds,
  mockPlanFixture,
  type MemoryCatalog,
  type WorkflowGraph,
  type WorkflowNodeDefinition,
} from "@workforce/application";
import type {
  TeamDto,
  TeamVersionDto,
  WorkerDto,
  WorkerVersionDto,
  WorkflowDto,
  WorkflowVersionDto,
} from "@workforce/protocol";

import type {
  NodeDto,
  PageDto,
  ProjectBudgetDto,
  RuntimeCapabilitiesDto,
  RuntimeDto,
} from "../modules/dto.js";

export const PROTOCOL_VERSION = "0.1" as const;
export const ORGANIZATION_ID = "org_local";

export const TEAM_ID = "tm_software_development";
export const TEAM_VERSION_ID = "tmv_software_development_0_1_0";
export const PLANNER_WORKER_ID = "wrk_software_planner";
export const PLANNER_WORKER_VERSION_ID = "wrv_software_planner_0_1_0";
export const DEVELOPER_WORKER_ID = "wrk_software_developer";
export const DEVELOPER_WORKER_VERSION_ID = "wrv_software_developer_0_1_0";
export const REVIEWER_WORKER_ID = "wrk_software_reviewer";
export const REVIEWER_WORKER_VERSION_ID = "wrv_software_reviewer_0_1_0";
const PRESET_WORKER_PUBLISHED_AT = "2026-01-01T00:00:00.000Z";
export const LOCAL_NODE_ID = "ndl_local";
export const MOCK_RUNTIME_ID = "mock";
export const MOCK_RUNTIME_INSTALLATION_ID = "rtm_mock_local";
export const MOCK_RUNTIME_VERSION = "0.1.0";
export const DEFAULT_BUDGET_ID = "bdg_local";
export const MOCK_WORKFLOW_GRAPH_ID = "wfv_mock_feature";
export const FEATURE_DELIVERY_WORKFLOW_ID = "software-development-team.feature-delivery";
export const FEATURE_DELIVERY_VERSION = "0.1.0";

/** Published software-dev feature-delivery template. Catalog only — not a Runtime execution graph. */
export const FEATURE_DELIVERY_WORKFLOW: WorkflowDto = {
  id: FEATURE_DELIVERY_WORKFLOW_ID,
  name: "Feature delivery",
  description:
    "Confirm a Plan Artifact, run two isolated Developer Tasks, integrate patches by stable Node ID, then Review and human artifact approval on one digest.",
  protocolVersion: PROTOCOL_VERSION,
  status: "published",
  activeVersionId: FEATURE_DELIVERY_VERSION,
  versions: [
    {
      id: FEATURE_DELIVERY_VERSION,
      workflowId: FEATURE_DELIVERY_WORKFLOW_ID,
      version: FEATURE_DELIVERY_VERSION,
      status: "published",
      immutable: true,
      entry: "planning",
      steps: [
        {
          id: "planning",
          kind: "task",
          title: "规划",
          worker: "planner",
          gate: "plan",
          notes: ["产出 Plan Artifact", "发布 workflowVersion"],
        },
        {
          id: "implementation",
          kind: "task",
          title: "实现",
          worker: "developer",
          notes: ["并行", "节点模式 dev_*", "上游 outputs_ready", "不等待 reviewer 即可完成"],
        },
        {
          id: "integration",
          kind: "delivery",
          title: "整合",
          notes: ["按 stable Node ID 顺序", "独立 integration worktree", "冲突转人工"],
        },
        {
          id: "review",
          kind: "task",
          title: "审查",
          worker: "reviewer",
          notes: ["上游 outputs_ready", "绑定 integration digest"],
        },
        {
          id: "acceptance",
          kind: "approval",
          title: "验收",
          gate: "artifact",
          notes: ["绑定 integration digest"],
        },
      ],
      nodes: [
        { id: "planning", kind: "task", role: "planner", title: "规划" },
        { id: "implementation", kind: "task", role: "developer", title: "实现" },
        { id: "integration", kind: "task", role: "developer", title: "整合" },
        { id: "review", kind: "task", role: "reviewer", title: "审查" },
        { id: "acceptance", kind: "approval", role: "approver", title: "验收" },
      ],
      edges: [
        { id: "e_plan_impl", from: "planning", to: "implementation", waitFor: "outputs_ready" },
        { id: "e_impl_int", from: "implementation", to: "integration", waitFor: "outputs_ready" },
        { id: "e_int_review", from: "integration", to: "review", waitFor: "outputs_ready" },
        { id: "e_review_accept", from: "review", to: "acceptance", waitFor: "outputs_ready" },
      ],
    },
  ],
};

export function publishedWorkflows(): WorkflowDto[] {
  return [FEATURE_DELIVERY_WORKFLOW];
}

export function findPublishedWorkflow(id: string): WorkflowDto | null {
  return FEATURE_DELIVERY_WORKFLOW.id === id ? FEATURE_DELIVERY_WORKFLOW : null;
}

export function findPublishedWorkflowVersion(
  workflowId: string,
  versionId: string,
): WorkflowVersionDto | null {
  const workflow = findPublishedWorkflow(workflowId);
  if (!workflow) {
    return null;
  }
  return (
    workflow.versions.find((item) => item.id === versionId || item.version === versionId) ?? null
  );
}

export const PRESET_PLANNER_WORKER_VERSION: WorkerVersionDto = {
  id: PLANNER_WORKER_VERSION_ID,
  workerId: PLANNER_WORKER_ID,
  version: "0.1.0",
  status: "published",
  immutable: true,
  archived: false,
  name: "Planner",
  role: "planner",
  runtimeProfileId: "mock",
  stateRevision: 1,
  publishedAt: PRESET_WORKER_PUBLISHED_AT,
};

export const PRESET_DEVELOPER_WORKER_VERSION: WorkerVersionDto = {
  id: DEVELOPER_WORKER_VERSION_ID,
  workerId: DEVELOPER_WORKER_ID,
  version: "0.1.0",
  status: "published",
  immutable: true,
  archived: false,
  name: "Developer",
  role: "developer",
  runtimeProfileId: "mock",
  stateRevision: 1,
  publishedAt: PRESET_WORKER_PUBLISHED_AT,
};

export const PRESET_REVIEWER_WORKER_VERSION: WorkerVersionDto = {
  id: REVIEWER_WORKER_VERSION_ID,
  workerId: REVIEWER_WORKER_ID,
  version: "0.1.0",
  status: "published",
  immutable: true,
  archived: false,
  name: "Reviewer",
  role: "reviewer",
  runtimeProfileId: "mock",
  stateRevision: 1,
  publishedAt: PRESET_WORKER_PUBLISHED_AT,
};

export const PRESET_WORKER_VERSIONS: readonly WorkerVersionDto[] = [
  PRESET_PLANNER_WORKER_VERSION,
  PRESET_DEVELOPER_WORKER_VERSION,
  PRESET_REVIEWER_WORKER_VERSION,
];

export const PRESET_PLANNER_WORKER: WorkerDto = {
  id: PLANNER_WORKER_ID,
  name: "Planner",
  protocolVersion: PROTOCOL_VERSION,
  status: "published",
  activeVersionId: PLANNER_WORKER_VERSION_ID,
  versions: [PRESET_PLANNER_WORKER_VERSION],
  stateRevision: 1,
  definitionRevision: 1,
};

export const PRESET_DEVELOPER_WORKER: WorkerDto = {
  id: DEVELOPER_WORKER_ID,
  name: "Developer",
  protocolVersion: PROTOCOL_VERSION,
  status: "published",
  activeVersionId: DEVELOPER_WORKER_VERSION_ID,
  versions: [PRESET_DEVELOPER_WORKER_VERSION],
  stateRevision: 1,
  definitionRevision: 1,
};

export const PRESET_REVIEWER_WORKER: WorkerDto = {
  id: REVIEWER_WORKER_ID,
  name: "Reviewer",
  protocolVersion: PROTOCOL_VERSION,
  status: "published",
  activeVersionId: REVIEWER_WORKER_VERSION_ID,
  versions: [PRESET_REVIEWER_WORKER_VERSION],
  stateRevision: 1,
  definitionRevision: 1,
};

export const PRESET_WORKERS: readonly WorkerDto[] = [
  PRESET_PLANNER_WORKER,
  PRESET_DEVELOPER_WORKER,
  PRESET_REVIEWER_WORKER,
];

export function findPublishedWorker(id: string): WorkerDto | null {
  return PRESET_WORKERS.find((item) => item.id === id) ?? null;
}

export function findPublishedWorkerVersion(
  workerId: string,
  versionId: string,
): WorkerVersionDto | null {
  const worker = findPublishedWorker(workerId);
  if (!worker) {
    return null;
  }
  return (
    worker.versions?.find((item) => item.id === versionId || item.version === versionId) ?? null
  );
}

export function isPresetPublishedWorkerVersion(versionId: string): boolean {
  return PRESET_WORKER_VERSIONS.some((item) => item.id === versionId || item.version === versionId);
}

/** Seed published Software Development Team WorkerVersions into the in-memory catalog. */
export function seedPresetWorkerLibrary(catalog: MemoryCatalog): void {
  for (const worker of PRESET_WORKERS) {
    if (catalog.workers.has(worker.id)) {
      continue;
    }
    const identity: WorkerDto = {
      id: worker.id,
      name: worker.name,
      protocolVersion: worker.protocolVersion,
      status: worker.status,
      stateRevision: worker.stateRevision,
      definitionRevision: worker.definitionRevision,
    };
    if (worker.activeVersionId !== undefined) {
      identity.activeVersionId = worker.activeVersionId;
    }
    catalog.workers.set(worker.id, identity);
  }
  for (const version of PRESET_WORKER_VERSIONS) {
    if (!catalog.workerVersions.has(version.id)) {
      catalog.workerVersions.set(version.id, version);
    }
  }
}

export const SOFTWARE_TEAM_VERSION: TeamVersionDto = {
  id: TEAM_VERSION_ID,
  teamId: TEAM_ID,
  version: "0.1.0",
  status: "published",
  immutable: true,
  members: [
    {
      id: "planner",
      role: "planner",
      workerVersionId: PLANNER_WORKER_VERSION_ID,
      runtimeProfileId: "mock",
      quantity: 1,
    },
    {
      id: "developer",
      role: "developer",
      workerVersionId: DEVELOPER_WORKER_VERSION_ID,
      runtimeProfileId: "mock",
      quantity: 2,
    },
    {
      id: "reviewer",
      role: "reviewer",
      workerVersionId: REVIEWER_WORKER_VERSION_ID,
      runtimeProfileId: "mock",
      quantity: 1,
    },
  ],
};

export const SOFTWARE_TEAM: TeamDto = {
  id: TEAM_ID,
  name: "Software Development Team",
  version: "0.1.0",
  status: "published",
  protocolVersion: PROTOCOL_VERSION,
  stateRevision: 1,
  activeVersionId: TEAM_VERSION_ID,
  roles: [
    { id: "planner", role: "planner", version: "0.1.0" },
    { id: "developer", role: "developer", version: "0.1.0" },
    { id: "reviewer", role: "reviewer", version: "0.1.0" },
  ],
  versions: [SOFTWARE_TEAM_VERSION],
};

export function findPublishedTeam(id: string): TeamDto | null {
  return SOFTWARE_TEAM.id === id ? SOFTWARE_TEAM : null;
}

export function findPublishedTeamVersion(teamId: string, versionId: string): TeamVersionDto | null {
  if (teamId !== TEAM_ID) {
    return null;
  }
  if (versionId === TEAM_VERSION_ID || versionId === SOFTWARE_TEAM_VERSION.version) {
    return SOFTWARE_TEAM_VERSION;
  }
  return null;
}

export function isPresetPublishedTeamVersion(versionId: string): boolean {
  return versionId === TEAM_VERSION_ID || versionId === SOFTWARE_TEAM_VERSION.version;
}

export const LOCAL_NODE: NodeDto = {
  id: LOCAL_NODE_ID,
  kind: "local",
  status: "online",
  platform: nodePlatform(),
  displayName: "Local Node",
  capacity: { maxConcurrentRuns: 8 },
};

export const MOCK_RUNTIME: RuntimeDto = {
  id: MOCK_RUNTIME_ID,
  displayName: "Mock Runtime",
  adapterId: MOCK_RUNTIME_ID,
  version: MOCK_RUNTIME_VERSION,
  protocolVersion: PROTOCOL_VERSION,
  transport: "sdk",
};

export const MOCK_RUNTIME_CAPABILITIES: RuntimeCapabilitiesDto = {
  runtimeId: MOCK_RUNTIME_ID,
  input: true,
  pause: false,
  resume: false,
  takeOver: false,
  capabilities: [
    { name: "coding", version: "1.0", available: true },
    { name: "interactive_input", version: "1.0", available: true },
    { name: "lifecycle.pause", version: "1.0", available: false },
    { name: "event.resume", version: "1.0", available: false },
  ],
};

export function unknownProjectBudget(projectId: string): ProjectBudgetDto {
  return {
    projectId,
    currency: "USD",
    kind: "unknown",
    reservedMinor: 0,
    settledMinor: 0,
    authorizationVersion: 1,
  };
}

export function estimatedProjectBudget(
  projectId: string,
  input: {
    estimatedLimitMinor: number;
    reservedMinor: number;
    settledMinor: number;
    authorizationVersion: number;
    currency?: string;
  },
): ProjectBudgetDto {
  return {
    projectId,
    currency: input.currency ?? "USD",
    kind: "estimated",
    estimatedLimitMinor: input.estimatedLimitMinor,
    reservedMinor: input.reservedMinor,
    settledMinor: input.settledMinor,
    authorizationVersion: input.authorizationVersion,
  };
}

export function pageOf<T>(items: T[]): PageDto<T> {
  return { items, page: { nextCursor: null, hasMore: false } };
}

export function mockPlanGraph(): WorkflowGraph {
  const plan = mockPlanFixture();
  const taskNodes = plan.nodes.filter((node) => node.kind === "task");
  const taskIds = new Set(taskNodes.map((node) => node.id));
  const entries = entryNodeIds(plan).filter((id) => taskIds.has(id));
  const nodes: WorkflowNodeDefinition[] = taskNodes.map((node) => {
    const definition: WorkflowNodeDefinition = {
      id: node.id,
      kind: "task",
      role: node.role,
      requiresReview: node.role === "reviewer",
      expectedOutputIds: node.expectedOutputs
        .filter((output) => output.required)
        .map((output) => output.id),
      maxAttempts: node.maxAttempts,
      maxReworkCycles: node.maxReworkCycles,
      priority: node.role === "reviewer" ? 10 : 80,
    };
    if (!entries.includes(node.id)) {
      definition.joinPolicy = "all_success";
    }
    return definition;
  });
  return {
    id: MOCK_WORKFLOW_GRAPH_ID,
    workflowId: plan.workflowId,
    version: 1,
    entryNodeIds: entries,
    terminalNodeIds: taskNodes.filter((node) => node.role === "reviewer").map((node) => node.id),
    nodes,
    edges: plan.edges
      .filter((edge) => taskIds.has(edge.from) && taskIds.has(edge.to))
      .map((edge) => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        waitFor: edge.onUpstream,
      })),
  };
}

function nodePlatform(): NodeDto["platform"] {
  if (process.platform === "win32") {
    return "windows";
  }
  if (process.platform === "darwin") {
    return "macos";
  }
  return "linux";
}
