import {
  isCanvasGate,
  isCanvasJoinPolicy,
  isCanvasNodeKind,
  isCanvasUpstreamWait,
  isCanvasWorkerRole,
  type CanvasGraph,
  type CanvasNode,
} from "./types.js";

export function parseGraphRecord(value: unknown): CanvasGraph | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const rawNodes = Array.isArray(record.nodes) ? record.nodes : null;
  const rawEdges = Array.isArray(record.edges) ? record.edges : null;
  if (!rawNodes || !rawEdges) {
    return null;
  }
  const layoutRecord =
    typeof record.layout === "object" && record.layout !== null
      ? (record.layout as Record<string, unknown>)
      : {};
  const nodes: CanvasNode[] = [];
  for (const [index, item] of rawNodes.entries()) {
    const node = parseNode(item, index, layoutRecord);
    if (node) {
      nodes.push(node);
    }
  }
  const edges = rawEdges
    .map((item, index) => parseEdge(item, index))
    .filter((item): item is CanvasGraph["edges"][number] => item !== null);
  const entryNodeIds = Array.isArray(record.entryNodeIds)
    ? record.entryNodeIds.filter((item): item is string => typeof item === "string")
    : typeof record.entry === "string"
      ? [record.entry]
      : [];
  return { nodes, edges, entryNodeIds };
}

function parseNode(
  value: unknown,
  index: number,
  layoutRecord: Record<string, unknown>,
): CanvasNode | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !isCanvasNodeKind(record.kind)) {
    return null;
  }
  const title = typeof record.title === "string" ? record.title : record.id;
  const notes = Array.isArray(record.notes)
    ? record.notes.filter((item): item is string => typeof item === "string")
    : [];
  const layoutValue = record.layout ?? layoutRecord[record.id];
  const layout =
    typeof layoutValue === "object" &&
    layoutValue !== null &&
    typeof (layoutValue as { x?: unknown }).x === "number" &&
    typeof (layoutValue as { y?: unknown }).y === "number"
      ? { x: (layoutValue as { x: number }).x, y: (layoutValue as { y: number }).y }
      : { x: 32 + (index % 4) * 224, y: 32 + Math.floor(index / 4) * 104 };
  const node: CanvasNode = { id: record.id, kind: record.kind, title, notes, layout };
  if (isCanvasWorkerRole(record.role)) {
    node.role = record.role;
  }
  if (isCanvasGate(record.gate)) {
    node.gate = record.gate;
  }
  if (isCanvasJoinPolicy(record.joinPolicy)) {
    node.joinPolicy = record.joinPolicy;
  }
  if (typeof record.minSuccess === "number") {
    node.minSuccess = record.minSuccess;
  }
  return node;
}

function parseEdge(value: unknown, index: number): CanvasGraph["edges"][number] | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.from !== "string" || typeof record.to !== "string") {
    return null;
  }
  const id = typeof record.id === "string" ? record.id : `e_${index}_${record.from}_${record.to}`;
  const edge: CanvasGraph["edges"][number] = { id, from: record.from, to: record.to };
  if (isCanvasUpstreamWait(record.waitFor)) {
    edge.waitFor = record.waitFor;
  }
  return edge;
}
