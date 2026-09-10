import type { DaemonHealth } from "./types.js";

export async function fetchDaemonHealth(port: number, timeoutMs = 800): Promise<DaemonHealth> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("invalid loopback port");
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: ac.signal });
    if (!res.ok) {
      throw new Error(`health HTTP ${res.status}`);
    }
    const json = (await res.json()) as Partial<DaemonHealth>;
    if (
      json.ok !== true ||
      typeof json.pid !== "number" ||
      typeof json.port !== "number" ||
      typeof json.startIdentity !== "string" ||
      typeof json.protocolVersion !== "string"
    ) {
      throw new Error("health payload invalid");
    }
    return {
      ok: true,
      pid: json.pid,
      port: json.port,
      startIdentity: json.startIdentity,
      protocolVersion: json.protocolVersion,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchDaemonVersion(
  port: number,
  timeoutMs = 800,
): Promise<{ protocolVersion: string }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/version`, { signal: ac.signal });
    if (!res.ok) {
      throw new Error(`version HTTP ${res.status}`);
    }
    const json = (await res.json()) as { protocolVersion?: unknown };
    if (typeof json.protocolVersion !== "string") {
      throw new Error("version payload invalid");
    }
    return { protocolVersion: json.protocolVersion };
  } finally {
    clearTimeout(timer);
  }
}
