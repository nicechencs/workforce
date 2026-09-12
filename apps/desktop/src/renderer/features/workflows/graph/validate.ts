import type { CanvasGraph } from "./types.js";

export type DagValidation = { ok: true; order: string[] } | { ok: false; reasons: string[] };

export function incomingEdges(graph: CanvasGraph, nodeId: string) {
  return graph.edges.filter((edge) => edge.to === nodeId);
}

export function outgoingEdges(graph: CanvasGraph, nodeId: string) {
  return graph.edges.filter((edge) => edge.from === nodeId);
}

export function topologicalOrder(graph: CanvasGraph): string[] | undefined {
  const incoming = new Map<string, number>();
  for (const node of graph.nodes) {
    incoming.set(node.id, 0);
  }
  for (const edge of graph.edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  const queue = graph.nodes
    .map((node) => node.id)
    .filter((id) => (incoming.get(id) ?? 0) === 0)
    .sort((a, b) => a.localeCompare(b));
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) {
      break;
    }
    order.push(id);
    for (const edge of outgoingEdges(graph, id)) {
      const next = (incoming.get(edge.to) ?? 0) - 1;
      incoming.set(edge.to, next);
      if (next === 0) {
        queue.push(edge.to);
        queue.sort((a, b) => a.localeCompare(b));
      }
    }
  }
  return order.length === graph.nodes.length ? order : undefined;
}

export function reachableFrom(graph: CanvasGraph, entries: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) {
      continue;
    }
    seen.add(id);
    for (const edge of outgoingEdges(graph, id)) {
      stack.push(edge.to);
    }
  }
  return seen;
}

/** Limited client-side DAG checks. Server publish (T09) remains authoritative. */
export function validateCanvasGraph(graph: CanvasGraph): DagValidation {
  const reasons: string[] = [];
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) {
      reasons.push(`重复节点 id ${node.id}`);
    }
    ids.add(node.id);
    if (node.id.trim().length === 0) {
      reasons.push("节点 id 不能为空");
    }
    if (node.title.trim().length === 0) {
      reasons.push(`节点 ${node.id} 缺少标题`);
    }
  }
  if (graph.nodes.length === 0) {
    reasons.push("尚未添加节点。空图不能发布。");
  }
  if (graph.entryNodeIds.length === 0 && graph.nodes.length > 0) {
    reasons.push("没有入口节点");
  }
  for (const entry of graph.entryNodeIds) {
    if (!ids.has(entry)) {
      reasons.push(`入口节点 ${entry} 不存在`);
    }
  }
  const edgeKeys = new Set<string>();
  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      reasons.push(`边 ${edge.id} 引用了不存在的节点`);
    }
    if (edge.from === edge.to) {
      reasons.push(`边 ${edge.id} 是自环`);
    }
    const key = `${edge.from}->${edge.to}`;
    if (edgeKeys.has(key)) {
      reasons.push(`重复边 ${key}`);
    }
    edgeKeys.add(key);
  }

  const order = topologicalOrder(graph);
  if (graph.nodes.length > 0 && !order) {
    reasons.push("图中存在循环，有限 DAG 不允许循环");
  }

  if (graph.entryNodeIds.length > 0) {
    const reachable = reachableFrom(graph, graph.entryNodeIds);
    for (const node of graph.nodes) {
      if (!reachable.has(node.id)) {
        reasons.push(`节点 ${node.id} 从入口不可达`);
      }
    }
  }

  for (const node of graph.nodes) {
    const inbound = incomingEdges(graph, node.id);
    if (inbound.length > 1 && node.kind !== "condition" && node.kind !== "parallel") {
      if (!node.joinPolicy) {
        reasons.push(`汇合节点 ${node.id} 必须声明 joinPolicy`);
      }
      if (node.joinPolicy === "min_success" && (node.minSuccess ?? 0) < 1) {
        reasons.push(`汇合节点 ${node.id} 的 min_success 需要 minSuccess >= 1`);
      }
    }
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }
  return { ok: true, order: order ?? graph.nodes.map((node) => node.id) };
}

export function firstValidationReason(graph: CanvasGraph): string | null {
  const result = validateCanvasGraph(graph);
  if (result.ok) {
    return null;
  }
  return result.reasons[0] ?? "图校验未通过";
}
