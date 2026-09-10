import { nodeById, type WorkflowGraph } from "./types.js";

export type DagValidation = { ok: true; order: string[] } | { ok: false; reason: string };

export function incomingEdges(graph: WorkflowGraph, nodeId: string) {
  return graph.edges.filter((edge) => edge.to === nodeId);
}

export function outgoingEdges(graph: WorkflowGraph, nodeId: string) {
  return graph.edges.filter((edge) => edge.from === nodeId);
}

export function topologicalOrder(graph: WorkflowGraph): string[] | undefined {
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

export function reachableFrom(graph: WorkflowGraph, entries: readonly string[]): Set<string> {
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

export function validateWorkflowGraph(graph: WorkflowGraph): DagValidation {
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) {
      return { ok: false, reason: `duplicate node id ${node.id}` };
    }
    ids.add(node.id);
  }
  if (graph.nodes.length === 0) {
    return { ok: false, reason: "workflow has no nodes" };
  }
  if (graph.entryNodeIds.length === 0) {
    return { ok: false, reason: "workflow has no entry nodes" };
  }
  for (const entry of graph.entryNodeIds) {
    if (!ids.has(entry)) {
      return { ok: false, reason: `entry node ${entry} does not exist` };
    }
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      return { ok: false, reason: `edge ${edge.id} references a missing node` };
    }
    if (edge.from === edge.to) {
      return { ok: false, reason: `edge ${edge.id} is a self-loop` };
    }
    if (edge.inputBindings) {
      const upstream = nodeById(graph, edge.from);
      const declared = new Set(upstream?.expectedOutputIds ?? []);
      for (const binding of edge.inputBindings) {
        if (!declared.has(binding.fromOutputId)) {
          return {
            ok: false,
            reason: `edge ${edge.id} binds unknown output ${binding.fromOutputId}`,
          };
        }
      }
    }
  }

  const order = topologicalOrder(graph);
  if (!order) {
    return { ok: false, reason: "workflow graph contains a cycle" };
  }

  const reachable = reachableFrom(graph, graph.entryNodeIds);
  for (const node of graph.nodes) {
    if (!reachable.has(node.id)) {
      return { ok: false, reason: `node ${node.id} is not reachable from an entry` };
    }
  }

  for (const node of graph.nodes) {
    if (node.kind === "condition") {
      const defaults = (node.branches ?? []).filter((branch) => branch.isDefault);
      if (defaults.length > 1) {
        return { ok: false, reason: `condition ${node.id} has more than one default branch` };
      }
      const values = new Set<string>();
      for (const branch of node.branches ?? []) {
        if (values.has(branch.value)) {
          return {
            ok: false,
            reason: `condition ${node.id} has overlapping branch ${branch.value}`,
          };
        }
        values.add(branch.value);
      }
    }
    const inbound = incomingEdges(graph, node.id);
    if (inbound.length > 1 && node.kind !== "condition") {
      if (!node.joinPolicy) {
        return { ok: false, reason: `join node ${node.id} must declare joinPolicy` };
      }
      if (node.joinPolicy === "min_success" && (node.minSuccess ?? 0) < 1) {
        return { ok: false, reason: `join node ${node.id} min_success requires minSuccess >= 1` };
      }
    }
    if ((node.maxAttempts ?? 1) < 1 || (node.maxReworkCycles ?? 0) < 0) {
      return { ok: false, reason: `node ${node.id} retry/rework limits are invalid` };
    }
  }

  const terminals = graph.terminalNodeIds ?? graph.nodes.map((node) => node.id);
  const canReachTerminal = terminals.some((id) => reachable.has(id));
  if (!canReachTerminal) {
    return { ok: false, reason: "no path from an entry to a terminal node" };
  }

  return { ok: true, order };
}
