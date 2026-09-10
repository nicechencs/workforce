import fs from "node:fs";
import path from "node:path";

import type { SessionSecrets } from "./ipc/rest-proxy.js";

export function bootstrapFilePath(stateDir: string): string {
  return path.join(stateDir, "bootstrap.json");
}

export function readBootstrapToken(stateDir: string): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(bootstrapFilePath(stateDir), "utf8")) as {
      bootstrapToken?: unknown;
    };
    return typeof raw.bootstrapToken === "string" && raw.bootstrapToken.length > 0
      ? raw.bootstrapToken
      : null;
  } catch {
    return null;
  }
}

export async function createDaemonSession(
  port: number,
  bootstrapToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SessionSecrets> {
  const res = await fetchImpl(`http://127.0.0.1:${port}/api/v1/session`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ bootstrapToken }),
  });
  const json = (await res.json()) as { sessionToken?: unknown };
  if (!res.ok || typeof json.sessionToken !== "string" || json.sessionToken.length === 0) {
    throw new Error("Failed to establish a daemon session");
  }
  return { sessionToken: json.sessionToken };
}

export async function establishSessionFromStateDir(
  port: number,
  stateDir: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SessionSecrets | null> {
  const token = readBootstrapToken(stateDir);
  if (!token) {
    return null;
  }
  return createDaemonSession(port, token, fetchImpl);
}
