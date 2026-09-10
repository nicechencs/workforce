import type { HealthDto, ReadyDto, VersionDto } from "@workforce/desktop-client";

export const LOCAL_NODE_ID = "local";

const LOCAL_NODE_IDS = new Set(["local", "local-node", "local_node", "本机"]);

export function isLocalNodeId(nodeId: string | undefined): boolean {
  if (nodeId === undefined || nodeId.length === 0) {
    return true;
  }
  return LOCAL_NODE_IDS.has(nodeId);
}

export function localNodeSubtitle(): string {
  return "探测结果待 Daemon 目录接口";
}

export function localNodeStatusLabel(input: { health: HealthDto | null; ready: ReadyDto | null }): {
  label: string;
  tone: "health" | "warning" | "muted";
} {
  if (input.health?.ok === true && input.ready?.ready === true) {
    return { label: "本机 Daemon 已连接", tone: "health" };
  }
  if (input.health?.ok === true) {
    return { label: "本机进程在线，就绪检查未通过", tone: "warning" };
  }
  return { label: "本机节点（未探测为远程在线机群）", tone: "muted" };
}

export function formatProbeSummary(input: {
  health: HealthDto | null;
  ready: ReadyDto | null;
  version: VersionDto | null;
}): string[] {
  const lines: string[] = ["类型：本机 / Mock", localNodeSubtitle()];
  if (input.version) {
    lines.push(`协议 ${input.version.protocolVersion} · API ${input.version.apiVersion}`);
  }
  if (input.health) {
    lines.push(`Daemon pid ${input.health.pid} · startIdentity ${input.health.startIdentity}`);
  }
  if (input.ready) {
    const checks = Object.entries(input.ready.checks)
      .map(([name, ok]) => `${name}:${ok ? "通过" : "失败"}`)
      .join(" · ");
    lines.push(checks.length > 0 ? `就绪检查 ${checks}` : "就绪检查：无");
  }
  return lines;
}
