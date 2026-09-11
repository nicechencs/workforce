/** Authoring graph aligned with workflow-engine NodeKind + catalog delivery steps. Not a second protocol. */

export const CANVAS_NODE_KINDS = ["task", "approval", "condition", "parallel", "delivery"] as const;
export type CanvasNodeKind = (typeof CANVAS_NODE_KINDS)[number];

export const WORKER_ROLES = ["planner", "developer", "reviewer", "approver"] as const;
export type CanvasWorkerRole = (typeof WORKER_ROLES)[number];

export const JOIN_POLICIES = ["all_success", "all_terminal", "min_success"] as const;
export type CanvasJoinPolicy = (typeof JOIN_POLICIES)[number];

export const UPSTREAM_WAITS = [
  "outputs_ready",
  "completed",
  "failed",
  "cancelled",
  "any_terminal",
] as const;
export type CanvasUpstreamWait = (typeof UPSTREAM_WAITS)[number];

export const WORKFLOW_GATES = ["plan", "artifact"] as const;
export type CanvasGate = (typeof WORKFLOW_GATES)[number];

export interface CanvasNodeLayout {
  x: number;
  y: number;
}

export interface CanvasNode {
  id: string;
  kind: CanvasNodeKind;
  title: string;
  role?: CanvasWorkerRole;
  gate?: CanvasGate;
  joinPolicy?: CanvasJoinPolicy;
  minSuccess?: number;
  notes: string[];
  layout: CanvasNodeLayout;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  waitFor?: CanvasUpstreamWait;
}

export interface CanvasGraph {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  entryNodeIds: string[];
}

/** Payload sent to M7 write endpoints once T02/T10 freeze the schema. */
export interface CanvasGraphPayload {
  nodes: readonly {
    id: string;
    kind: CanvasNodeKind;
    role?: CanvasWorkerRole;
    gate?: CanvasGate;
    joinPolicy?: CanvasJoinPolicy;
    minSuccess?: number;
    title: string;
    notes: readonly string[];
  }[];
  edges: readonly {
    id: string;
    from: string;
    to: string;
    waitFor?: CanvasUpstreamWait;
  }[];
  entryNodeIds: readonly string[];
  layout: Record<string, CanvasNodeLayout>;
}

export function emptyCanvasGraph(): CanvasGraph {
  return { nodes: [], edges: [], entryNodeIds: [] };
}

export function isCanvasNodeKind(value: unknown): value is CanvasNodeKind {
  return typeof value === "string" && (CANVAS_NODE_KINDS as readonly string[]).includes(value);
}

export function isCanvasWorkerRole(value: unknown): value is CanvasWorkerRole {
  return typeof value === "string" && (WORKER_ROLES as readonly string[]).includes(value);
}

export function isCanvasJoinPolicy(value: unknown): value is CanvasJoinPolicy {
  return typeof value === "string" && (JOIN_POLICIES as readonly string[]).includes(value);
}

export function isCanvasUpstreamWait(value: unknown): value is CanvasUpstreamWait {
  return typeof value === "string" && (UPSTREAM_WAITS as readonly string[]).includes(value);
}

export function isCanvasGate(value: unknown): value is CanvasGate {
  return typeof value === "string" && (WORKFLOW_GATES as readonly string[]).includes(value);
}

export function toGraphPayload(graph: CanvasGraph): CanvasGraphPayload {
  const layout: Record<string, CanvasNodeLayout> = {};
  const nodes = graph.nodes.map((node) => {
    layout[node.id] = { ...node.layout };
    const payload: CanvasGraphPayload["nodes"][number] = {
      id: node.id,
      kind: node.kind,
      title: node.title,
      notes: [...node.notes],
    };
    return withOptionalNodeFields(payload, node);
  });
  const edges = graph.edges.map((edge) => {
    const payload: CanvasGraphPayload["edges"][number] = {
      id: edge.id,
      from: edge.from,
      to: edge.to,
    };
    if (edge.waitFor !== undefined) {
      return { ...payload, waitFor: edge.waitFor };
    }
    return payload;
  });
  return {
    nodes,
    edges,
    entryNodeIds: [...graph.entryNodeIds],
    layout,
  };
}

function withOptionalNodeFields(
  payload: CanvasGraphPayload["nodes"][number],
  node: CanvasNode,
): CanvasGraphPayload["nodes"][number] {
  let next = payload;
  if (node.role !== undefined) {
    next = { ...next, role: node.role };
  }
  if (node.gate !== undefined) {
    next = { ...next, gate: node.gate };
  }
  if (node.joinPolicy !== undefined) {
    next = { ...next, joinPolicy: node.joinPolicy };
  }
  if (node.minSuccess !== undefined) {
    next = { ...next, minSuccess: node.minSuccess };
  }
  return next;
}
