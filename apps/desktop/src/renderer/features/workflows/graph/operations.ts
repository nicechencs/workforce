import {
  emptyCanvasGraph,
  type CanvasGraph,
  type CanvasNode,
  type CanvasNodeKind,
  type CanvasUpstreamWait,
} from "./types.js";

const NODE_WIDTH = 188;
const NODE_HEIGHT = 76;
const COL_GAP = 36;
const ROW_GAP = 28;
const ORIGIN_X = 32;
const ORIGIN_Y = 32;

export const CANVAS_NODE_SIZE = { width: NODE_WIDTH, height: NODE_HEIGHT };

export function nextNodeId(graph: CanvasGraph, kind: CanvasNodeKind): string {
  const prefix = kind;
  let n = graph.nodes.filter(
    (node) => node.id === prefix || node.id.startsWith(`${prefix}_`),
  ).length;
  let candidate = n === 0 ? prefix : `${prefix}_${n + 1}`;
  const used = new Set(graph.nodes.map((node) => node.id));
  while (used.has(candidate)) {
    n += 1;
    candidate = `${prefix}_${n + 1}`;
  }
  return candidate;
}

export function nextEdgeId(graph: CanvasGraph, from: string, to: string): string {
  const base = `e_${from}_${to}`;
  if (!graph.edges.some((edge) => edge.id === base)) {
    return base;
  }
  let n = 2;
  let candidate = `${base}_${n}`;
  while (graph.edges.some((edge) => edge.id === candidate)) {
    n += 1;
    candidate = `${base}_${n}`;
  }
  return candidate;
}

export function defaultTitle(kind: CanvasNodeKind): string {
  switch (kind) {
    case "task":
      return "任务";
    case "approval":
      return "审批";
    case "condition":
      return "条件";
    case "parallel":
      return "并行";
    case "delivery":
      return "交付";
  }
}

function nextSlot(graph: CanvasGraph): { x: number; y: number } {
  const col = graph.nodes.length % 4;
  const row = Math.floor(graph.nodes.length / 4);
  return {
    x: ORIGIN_X + col * (NODE_WIDTH + COL_GAP),
    y: ORIGIN_Y + row * (NODE_HEIGHT + ROW_GAP),
  };
}

export function addNode(graph: CanvasGraph, kind: CanvasNodeKind, id?: string): CanvasGraph {
  const nodeId = id && id.trim().length > 0 ? id.trim() : nextNodeId(graph, kind);
  if (graph.nodes.some((node) => node.id === nodeId)) {
    return graph;
  }
  const node: CanvasNode = {
    id: nodeId,
    kind,
    title: defaultTitle(kind),
    notes: [],
    layout: nextSlot(graph),
  };
  if (kind === "approval") {
    node.gate = "artifact";
  }
  if (kind === "task") {
    node.role = "developer";
  }
  const entryNodeIds = graph.entryNodeIds.length === 0 ? [nodeId] : [...graph.entryNodeIds];
  return {
    nodes: [...graph.nodes, node],
    edges: [...graph.edges],
    entryNodeIds,
  };
}

export function removeNode(graph: CanvasGraph, nodeId: string): CanvasGraph {
  const nodes = graph.nodes.filter((node) => node.id !== nodeId);
  const edges = graph.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
  let entryNodeIds = graph.entryNodeIds.filter((id) => id !== nodeId);
  if (entryNodeIds.length === 0 && nodes[0]) {
    entryNodeIds = [nodes[0].id];
  }
  return { nodes, edges, entryNodeIds };
}

export type CanvasNodePatch = Partial<Omit<CanvasNode, "id" | "layout">> & {
  layout?: CanvasNode["layout"];
};

export function updateNode(
  graph: CanvasGraph,
  nodeId: string,
  patch: CanvasNodePatch,
): CanvasGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === nodeId ? { ...node, ...patch, id: node.id } : node,
    ),
  };
}

export function unsetNodeFields(
  graph: CanvasGraph,
  nodeId: string,
  fields: readonly ("role" | "gate" | "joinPolicy" | "minSuccess")[],
): CanvasGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.id !== nodeId) {
        return node;
      }
      const next: CanvasNode = {
        id: node.id,
        kind: node.kind,
        title: node.title,
        notes: node.notes,
        layout: node.layout,
      };
      if (node.role !== undefined && !fields.includes("role")) {
        next.role = node.role;
      }
      if (node.gate !== undefined && !fields.includes("gate")) {
        next.gate = node.gate;
      }
      if (node.joinPolicy !== undefined && !fields.includes("joinPolicy")) {
        next.joinPolicy = node.joinPolicy;
      }
      if (node.minSuccess !== undefined && !fields.includes("minSuccess")) {
        next.minSuccess = node.minSuccess;
      }
      return next;
    }),
  };
}

export function moveNode(graph: CanvasGraph, nodeId: string, x: number, y: number): CanvasGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => (node.id === nodeId ? { ...node, layout: { x, y } } : node)),
  };
}

export function connectNodes(
  graph: CanvasGraph,
  from: string,
  to: string,
  waitFor?: CanvasUpstreamWait,
): { graph: CanvasGraph; error: string | null } {
  if (from === to) {
    return { graph, error: "不能连接节点到自身（自环）" };
  }
  if (
    !graph.nodes.some((node) => node.id === from) ||
    !graph.nodes.some((node) => node.id === to)
  ) {
    return { graph, error: "连接引用了不存在的节点" };
  }
  if (graph.edges.some((edge) => edge.from === from && edge.to === to)) {
    return { graph, error: "这两节点之间已有边" };
  }
  const edge = {
    id: nextEdgeId(graph, from, to),
    from,
    to,
    ...(waitFor !== undefined ? { waitFor } : { waitFor: "outputs_ready" as const }),
  };
  const next: CanvasGraph = { ...graph, edges: [...graph.edges, edge] };
  return { graph: next, error: null };
}

export function removeEdge(graph: CanvasGraph, edgeId: string): CanvasGraph {
  return { ...graph, edges: graph.edges.filter((edge) => edge.id !== edgeId) };
}

export function setEntryNode(graph: CanvasGraph, nodeId: string, isEntry: boolean): CanvasGraph {
  if (!graph.nodes.some((node) => node.id === nodeId)) {
    return graph;
  }
  const has = graph.entryNodeIds.includes(nodeId);
  if (isEntry && !has) {
    return { ...graph, entryNodeIds: [...graph.entryNodeIds, nodeId] };
  }
  if (!isEntry && has) {
    const entryNodeIds = graph.entryNodeIds.filter((id) => id !== nodeId);
    return { ...graph, entryNodeIds };
  }
  return graph;
}

export function layoutGraph(graph: CanvasGraph): CanvasGraph {
  if (graph.nodes.length === 0) {
    return emptyCanvasGraph();
  }
  const levels = new Map<string, number>();
  const queue = [...graph.entryNodeIds];
  for (const id of queue) {
    levels.set(id, 0);
  }
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) {
      break;
    }
    const level = levels.get(id) ?? 0;
    for (const edge of graph.edges.filter((item) => item.from === id)) {
      const next = level + 1;
      const current = levels.get(edge.to);
      if (current === undefined || next > current) {
        levels.set(edge.to, next);
        queue.push(edge.to);
      }
    }
  }
  let orphanCol = 0;
  for (const node of graph.nodes) {
    if (!levels.has(node.id)) {
      orphanCol += 1;
      levels.set(node.id, (graph.entryNodeIds.length > 0 ? 1 : 0) + orphanCol);
    }
  }
  const buckets = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const level = levels.get(node.id) ?? 0;
    const bucket = buckets.get(level) ?? [];
    bucket.push(node.id);
    buckets.set(level, bucket);
  }
  const positioned = new Map<string, { x: number; y: number }>();
  for (const [level, ids] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    ids.sort((a, b) => a.localeCompare(b));
    ids.forEach((id, index) => {
      positioned.set(id, {
        x: ORIGIN_X + level * (NODE_WIDTH + COL_GAP),
        y: ORIGIN_Y + index * (NODE_HEIGHT + ROW_GAP),
      });
    });
  }
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const layout = positioned.get(node.id);
      return layout ? { ...node, layout } : node;
    }),
  };
}
