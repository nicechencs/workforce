import type { ApiRequest, ApiResponse } from "@workforce/ui";

import { assertSafeApiRequest } from "./allowlist.js";

export interface SessionSecrets {
  sessionToken: string;
}

export interface LoopbackTarget {
  port: number;
}

export function buildLoopbackUrl(port: number, apiPath: string): string {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("invalid loopback port");
  }
  return `http://127.0.0.1:${port}${apiPath}`;
}

export async function proxyApiRequest(
  request: ApiRequest,
  target: LoopbackTarget,
  session: SessionSecrets | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResponse> {
  const safe = assertSafeApiRequest(request);
  const headers: Record<string, string> = { accept: "application/json", ...safe.headers };
  if (session) {
    headers.authorization = `Bearer ${session.sessionToken}`;
  }
  const init: RequestInit = { method: safe.method, headers };
  if (safe.method !== "GET" && safe.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(safe.body);
  }
  const res = await fetchImpl(buildLoopbackUrl(target.port, safe.path), init);
  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { raw: text };
    }
  }
  if (!res.ok) {
    const record = body as { code?: unknown; message?: unknown } | null;
    return {
      ok: false,
      status: res.status,
      code: typeof record?.code === "string" ? record.code : "request_failed",
      message: typeof record?.message === "string" ? record.message : `HTTP ${res.status}`,
    };
  }
  return { ok: true, status: res.status, body };
}
