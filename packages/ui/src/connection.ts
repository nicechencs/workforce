export const CONNECTION_STATUSES = [
  "loading",
  "online",
  "offline",
  "version-mismatch",
  "error",
] as const;

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export type ConnectionSnapshot =
  | { status: "loading" }
  | { status: "online"; protocolVersion: string; mode: "spawn" | "reconnect" }
  | { status: "offline" }
  | {
      status: "version-mismatch";
      expectedProtocolVersion: string;
      actualProtocolVersion: string;
      recoverable: true;
    }
  | { status: "error"; message: string; recoverable: true };

export function isConnectionSnapshot(value: unknown): value is ConnectionSnapshot {
  if (typeof value !== "object" || value === null || !("status" in value)) {
    return false;
  }
  const status = (value as { status: unknown }).status;
  return (CONNECTION_STATUSES as readonly string[]).includes(String(status));
}

export function connectionAllowsNavigation(snapshot: ConnectionSnapshot): boolean {
  return snapshot.status === "online";
}
