import {
  entryNodeIds,
  mockPlanFixture,
  type WorkflowGraph,
  type WorkflowNodeDefinition,
} from "@workforce/application";

import type {
  NodeDto,
  PageDto,
  ProjectBudgetDto,
  RuntimeCapabilitiesDto,
  RuntimeDto,
  TeamDto,
} from "../modules/dto.js";

export const PROTOCOL_VERSION = "0.1" as const;
export const ORGANIZATION_ID = "org_local";

export const TEAM_ID = "tm_software_development";
export const TEAM_VERSION_ID = "tmv_software_development_0_1_0";
export const LOCAL_NODE_ID = "ndl_local";
export const MOCK_RUNTIME_ID = "mock";
export const MOCK_RUNTIME_INSTALLATION_ID = "rtm_mock_local";
export const MOCK_RUNTIME_VERSION = "0.1.0";
export const DEFAULT_BUDGET_ID = "bdg_local";
export const MOCK_WORKFLOW_GRAPH_ID = "wfv_mock_feature";

export const SOFTWARE_TEAM: TeamDto = {
  id: TEAM_ID,
  name: "Software Development Team",
  version: "0.1.0",
  status: "published",
  protocolVersion: PROTOCOL_VERSION,
  roles: [
    { id: "planner", role: "planner", version: "0.1.0" },
    { id: "developer", role: "developer", version: "0.1.0" },
    { id: "reviewer", role: "reviewer", version: "0.1.0" },
  ],
};

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
