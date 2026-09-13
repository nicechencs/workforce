import { assertNoSecretFields, type ConnectionSnapshot } from "@workforce/ui";

import {
  recordSessionFailureDiagnostic,
  sessionFailureMessage,
} from "./daemon-supervisor/diagnostics.js";
import { ensureDaemon } from "./daemon-supervisor/supervisor.js";
import type { SupervisorDeps } from "./daemon-supervisor/types.js";
import { ipcPushChannels } from "./composition.js";
import { createDaemonSseBridge } from "./ipc/sse-bridge.js";
import {
  EventSubscriptionHub,
  type EventSubscribeInput,
  type LiveSubscription,
} from "./ipc/subscriptions.js";
import type { SessionSecrets } from "./ipc/rest-proxy.js";
import { establishSessionFromStateDir } from "./session.js";

export interface DesktopRuntimeSession {
  getSnapshot(): ConnectionSnapshot;
  connect(): Promise<ConnectionSnapshot>;
  loopback(): { port: number; session: SessionSecrets | null } | null;
  subscribe(input: EventSubscribeInput): { subscription: LiveSubscription; created: boolean };
  unsubscribe(id: string): boolean;
  dispose(): void;
}

export function createDesktopRuntimeSession(options: {
  supervisor: SupervisorDeps;
  stateDir: string;
  fetchImpl: typeof fetch;
  send: (channel: string, payload: unknown) => void;
}): DesktopRuntimeSession {
  const push = ipcPushChannels();
  const hub = new EventSubscriptionHub();
  let snapshot: ConnectionSnapshot = { status: "loading" };
  let session: SessionSecrets | null = null;
  let port: number | null = null;

  const setSnapshot = (next: ConnectionSnapshot): void => {
    assertNoSecretFields(next);
    snapshot = next;
    options.send(push.connectionChanged, next);
  };

  const sse = createDaemonSseBridge({
    getTarget: () => (port !== null && session ? { port, session } : null),
    send: (payload) => {
      options.send(push.event, payload);
    },
    fetchImpl: options.fetchImpl,
  });

  const connect = async (): Promise<ConnectionSnapshot> => {
    setSnapshot({ status: "loading" });
    const result = await ensureDaemon(options.supervisor);
    if (!result.ok) {
      session = null;
      port = null;
      sse.stop();
      setSnapshot(result.snapshot);
      return result.snapshot;
    }
    port = result.state.port;
    try {
      session = await establishSessionFromStateDir(port, options.stateDir, options.fetchImpl);
    } catch (error) {
      session = null;
      const errorSnapshot: ConnectionSnapshot = {
        status: "error",
        message: sessionFailureMessage(error, options.stateDir),
        recoverable: true,
      };
      recordSessionFailureDiagnostic(options.stateDir, error, new Date(), result.state);
      setSnapshot(errorSnapshot);
      return errorSnapshot;
    }
    setSnapshot(result.snapshot);
    for (const subscription of hub.list()) {
      void sse.start(subscription);
    }
    return result.snapshot;
  };

  return {
    getSnapshot: () => snapshot,
    connect,
    loopback: () => (port === null ? null : { port, session }),
    subscribe(input) {
      const result = hub.subscribe(input);
      if (result.created) {
        void sse.start(result.subscription);
      }
      return result;
    },
    unsubscribe(id) {
      const removed = hub.unsubscribe(id);
      if (hub.size === 0) {
        sse.stop();
      }
      return removed;
    },
    dispose() {
      sse.stop();
      hub.clear();
    },
  };
}
