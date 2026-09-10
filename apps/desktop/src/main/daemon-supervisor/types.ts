import type { ConnectionSnapshot } from "@workforce/ui";

export const DAEMON_MUTEX_NAME = "Local\\WorkforceDaemon" as const;

export interface DaemonStateFile {
  pid: number;
  port: number;
  startIdentity: string;
  osStartIdentity: string;
  startedAt: string;
  protocolVersion: string;
}

export interface DaemonHealth {
  ok: true;
  pid: number;
  port: number;
  startIdentity: string;
  protocolVersion: string;
}

export type InspectStatus =
  | "none"
  | "live"
  | "stale-dead-pid"
  | "stale-pid-reuse"
  | "stale-identity-mismatch"
  | "stale-unhealthy";

export type InspectResult =
  | { status: "none"; state: null }
  | { status: "live"; state: DaemonStateFile; health: DaemonHealth }
  | { status: "stale-dead-pid"; state: DaemonStateFile }
  | { status: "stale-pid-reuse"; state: DaemonStateFile }
  | { status: "stale-identity-mismatch"; state: DaemonStateFile }
  | { status: "stale-unhealthy"; state: DaemonStateFile };

export type SupervisorPhase =
  | "idle"
  | "discovering"
  | "spawning"
  | "reconnecting"
  | "handshake"
  | "connected"
  | "disconnected"
  | "version_incompatible"
  | "daemon_unhealthy";

export type EnsureDaemonResult =
  | {
      ok: true;
      mode: "spawn" | "reconnect";
      state: DaemonStateFile;
      health: DaemonHealth;
      snapshot: Extract<ConnectionSnapshot, { status: "online" }>;
    }
  | {
      ok: false;
      snapshot: Extract<
        ConnectionSnapshot,
        { status: "version-mismatch" } | { status: "error" } | { status: "offline" }
      >;
      spawned: false;
    };

export interface DaemonLaunchSpec {
  execPath: string;
  args: readonly string[];
}

export interface SpawnedDaemon {
  pid: number | undefined;
  unref: () => void;
  kill: (signal?: NodeJS.Signals) => boolean;
}

export interface SupervisorDeps {
  expectedProtocolVersion: string;
  stateDir: string;
  launch: DaemonLaunchSpec;
  now(): Date;
  readState(): DaemonStateFile | null;
  writeState(state: DaemonStateFile): void;
  pidAlive(pid: number): boolean;
  readOsStartIdentity(pid: number): Promise<string | null>;
  healthOf(port: number): Promise<DaemonHealth>;
  spawn(spec: DaemonLaunchSpec): SpawnedDaemon;
  wait(ms: number): Promise<void>;
  probeLockHeld(): Promise<boolean>;
  spawnTimeoutMs?: number;
  spawnPollMs?: number;
}
