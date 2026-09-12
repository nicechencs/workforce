import { isRunStatus } from "@workforce/protocol";

import { pidAlive, readDaemonState } from "../daemon-supervisor/state.js";
import { buildLoopbackUrl } from "../ipc/rest-proxy.js";
import { establishSessionFromStateDir } from "../session.js";
import { isNonTerminalRunStatus } from "./policy.js";

export interface ActiveRunProbeInput {
  stateDir: string;
  fetchImpl?: typeof fetch;
  limit?: number;
}

export type ActiveRunProbe =
  | {
      ok: true;
      daemonRunning: false;
      hasNonTerminalRun: false;
      runIds: [];
    }
  | {
      ok: true;
      daemonRunning: true;
      hasNonTerminalRun: boolean;
      runIds: string[];
    }
  | {
      ok: false;
      daemonRunning: boolean;
      hasNonTerminalRun: true;
      reason: "daemon_unreachable" | "session_unavailable" | "runs_unreadable";
    };

interface RunListPage {
  items: Array<{ id?: unknown; status?: unknown }>;
  page?: { nextCursor?: string | null; hasMore?: boolean };
}

function asRunListPage(body: unknown): RunListPage | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as { items?: unknown; page?: { nextCursor?: unknown; hasMore?: unknown } };
  if (!Array.isArray(record.items)) {
    return null;
  }
  return {
    items: record.items as Array<{ id?: unknown; status?: unknown }>,
    page: {
      nextCursor: typeof record.page?.nextCursor === "string" ? record.page.nextCursor : null,
      hasMore: record.page?.hasMore === true,
    },
  };
}

export async function probeNonTerminalRuns(input: ActiveRunProbeInput): Promise<ActiveRunProbe> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const state = readDaemonState(input.stateDir);
  if (!state || !pidAlive(state.pid)) {
    return { ok: true, daemonRunning: false, hasNonTerminalRun: false, runIds: [] };
  }

  let session;
  try {
    session = await establishSessionFromStateDir(state.port, input.stateDir, fetchImpl);
  } catch {
    return {
      ok: false,
      daemonRunning: true,
      hasNonTerminalRun: true,
      reason: "session_unavailable",
    };
  }
  if (!session) {
    return {
      ok: false,
      daemonRunning: true,
      hasNonTerminalRun: true,
      reason: "session_unavailable",
    };
  }

  const runIds: string[] = [];
  const limit = input.limit ?? 100;
  let cursor: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) {
      query.set("cursor", cursor);
    }
    let body: unknown;
    try {
      const res = await fetchImpl(
        buildLoopbackUrl(state.port, `/api/v1/runs?${query.toString()}`),
        {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${session.sessionToken}`,
          },
        },
      );
      if (!res.ok) {
        return {
          ok: false,
          daemonRunning: true,
          hasNonTerminalRun: true,
          reason: "runs_unreadable",
        };
      }
      body = await res.json();
    } catch {
      return {
        ok: false,
        daemonRunning: true,
        hasNonTerminalRun: true,
        reason: "daemon_unreachable",
      };
    }
    const page = asRunListPage(body);
    if (!page) {
      return {
        ok: false,
        daemonRunning: true,
        hasNonTerminalRun: true,
        reason: "runs_unreadable",
      };
    }
    for (const item of page.items) {
      if (typeof item.id !== "string" || typeof item.status !== "string") {
        return {
          ok: false,
          daemonRunning: true,
          hasNonTerminalRun: true,
          reason: "runs_unreadable",
        };
      }
      if (!isRunStatus(item.status) || isNonTerminalRunStatus(item.status)) {
        runIds.push(item.id);
      }
    }
    if (!page.page?.hasMore || typeof page.page.nextCursor !== "string") {
      break;
    }
    cursor = page.page.nextCursor ?? undefined;
    if (!cursor) {
      break;
    }
  }

  return {
    ok: true,
    daemonRunning: true,
    hasNonTerminalRun: runIds.length > 0,
    runIds,
  };
}
