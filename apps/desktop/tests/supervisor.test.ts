import { describe, expect, it } from "vitest";

import { ensureDaemon } from "../src/main/daemon-supervisor/supervisor.js";
import type {
  DaemonHealth,
  DaemonStateFile,
  SpawnedDaemon,
  SupervisorDeps,
} from "../src/main/daemon-supervisor/types.js";

const liveState: DaemonStateFile = {
  pid: 100,
  port: 3456,
  startIdentity: "100:2026-09-10T10:00:00.000Z:aaa",
  osStartIdentity: "win32:100:2026-09-10T10:00:00.000Z",
  startedAt: "2026-09-10T10:00:00.000Z",
  protocolVersion: "0.1",
};

const liveHealth: DaemonHealth = {
  ok: true,
  pid: 100,
  port: 3456,
  startIdentity: liveState.startIdentity,
  protocolVersion: "0.1",
};

function noopDaemon(): SpawnedDaemon {
  return { pid: 200, unref() {}, kill: () => true };
}

function createDeps(
  input: {
    state: DaemonStateFile | null;
    pidAlive?: (pid: number) => boolean;
    osStart?: string | null;
    health?: DaemonHealth | (() => Promise<DaemonHealth>);
    afterSpawnState?: DaemonStateFile;
  },
  spawned: { count: number },
): SupervisorDeps {
  let state = input.state;
  return {
    expectedProtocolVersion: "0.1",
    stateDir: "C:\\\\tmp\\\\workforce",
    launch: { execPath: "node", args: ["daemon.mjs"] },
    now: () => new Date("2026-09-10T10:00:00.000Z"),
    readState: () => state,
    writeState: (next) => {
      state = next;
    },
    pidAlive: input.pidAlive ?? ((pid) => pid === 100),
    readOsStartIdentity: async () => input.osStart ?? liveState.osStartIdentity,
    healthOf:
      typeof input.health === "function"
        ? input.health
        : async () => {
            if (input.health) {
              return input.health;
            }
            throw new Error("offline");
          },
    spawn: () => {
      spawned.count += 1;
      if (input.afterSpawnState) {
        state = input.afterSpawnState;
      }
      return noopDaemon();
    },
    wait: async () => undefined,
    probeLockHeld: async () => false,
    spawnTimeoutMs: 20,
    spawnPollMs: 1,
  };
}

describe("ensureDaemon", () => {
  it("reconnects a live matching instance without spawning", async () => {
    const spawned = { count: 0 };
    const result = await ensureDaemon(
      createDeps({ state: liveState, health: liveHealth }, spawned),
    );
    expect(spawned.count).toBe(0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe("reconnect");
      expect(result.snapshot.status).toBe("online");
    }
  });

  it("does not spawn a second daemon on version mismatch", async () => {
    const spawned = { count: 0 };
    const result = await ensureDaemon(
      createDeps({ state: liveState, health: { ...liveHealth, protocolVersion: "0.0" } }, spawned),
    );
    expect(spawned.count).toBe(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.spawned).toBe(false);
      expect(result.snapshot.status).toBe("version-mismatch");
    }
  });

  it("does not spawn or kill when a live pid is unhealthy", async () => {
    const spawned = { count: 0 };
    const result = await ensureDaemon(createDeps({ state: liveState }, spawned));
    expect(spawned.count).toBe(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.snapshot.status).toBe("error");
      expect(result.snapshot.recoverable).toBe(true);
    }
  });

  it("spawns a replacement when the recorded pid is dead", async () => {
    const spawned = { count: 0 };
    const replacement: DaemonStateFile = {
      pid: 200,
      port: 4000,
      startIdentity: "200:2026-09-10T10:01:00.000Z:bbb",
      osStartIdentity: "win32:200:2026-09-10T10:01:00.000Z",
      startedAt: "2026-09-10T10:01:00.000Z",
      protocolVersion: "0.1",
    };
    const result = await ensureDaemon(
      createDeps(
        {
          state: liveState,
          pidAlive: (pid) => pid === 200,
          afterSpawnState: replacement,
          health: {
            ok: true,
            pid: 200,
            port: 4000,
            startIdentity: replacement.startIdentity,
            protocolVersion: "0.1",
          },
        },
        spawned,
      ),
    );
    expect(spawned.count).toBe(1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mode).toBe("spawn");
    }
  });

  it("treats pid reuse as stale and starts a new daemon", async () => {
    const spawned = { count: 0 };
    const replacement: DaemonStateFile = {
      pid: 200,
      port: 4001,
      startIdentity: "200:new",
      osStartIdentity: "win32:200:new",
      startedAt: "2026-09-10T10:02:00.000Z",
      protocolVersion: "0.1",
    };
    const result = await ensureDaemon(
      createDeps(
        {
          state: liveState,
          osStart: "win32:100:OTHER",
          afterSpawnState: replacement,
          health: {
            ok: true,
            pid: 200,
            port: 4001,
            startIdentity: replacement.startIdentity,
            protocolVersion: "0.1",
          },
        },
        spawned,
      ),
    );
    expect(spawned.count).toBe(1);
    expect(result.ok).toBe(true);
  });
});
