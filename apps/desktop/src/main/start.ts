import { protocolVersion } from "@workforce/protocol";
import { assertNoSecretFields, type ConnectionSnapshot } from "@workforce/ui";

import { ensureDaemon } from "./daemon-supervisor/supervisor.js";
import type { SupervisorDeps } from "./daemon-supervisor/types.js";
import {
  applyLastWindowClose,
  applyUiSingleInstancePolicy,
  attachIpcHandlers,
  focusExistingWindow,
  ipcPushChannels,
  proxyConnectedApiRequest,
  resolvePreloadPath,
  resolveRendererLoadTarget,
} from "./composition.js";
import { createDaemonSseBridge } from "./ipc/sse-bridge.js";
import { EventSubscriptionHub } from "./ipc/subscriptions.js";
import { WorkspaceGrantStore } from "./ipc/workspace-picker.js";
import type { SessionSecrets } from "./ipc/rest-proxy.js";
import { establishSessionFromStateDir } from "./session.js";
import { createSupervisorDeps, resolveDesktopStateDir } from "./supervisor-runtime.js";
import { createMainWindowSpec, type BrowserWindowSpec } from "./windows/factory.js";

export interface DesktopWindowPort {
  loadURL(url: string): Promise<void>;
  loadFile(file: string): Promise<void>;
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
  onClosed(listener: () => void): void;
  send(channel: string, payload: unknown): void;
  openDevTools?(): void;
}

export interface DesktopAppPorts {
  requestSingleInstanceLock(): boolean;
  onSecondInstance(listener: () => void): void;
  onWindowAllClosed(listener: () => void): void;
  whenReady(): Promise<void>;
  quit(): void;
  createWindow(spec: BrowserWindowSpec): DesktopWindowPort;
  handleIpc(channel: string, listener: (payload: unknown) => Promise<unknown>): void;
  pickDirectory(): Promise<string | null>;
}

export interface StartDesktopOptions {
  appRoot: string;
  env?: Record<string, string | undefined>;
  ports: DesktopAppPorts;
  supervisor?: SupervisorDeps;
  fetchImpl?: typeof fetch;
}

export async function startDesktopApp(options: StartDesktopOptions): Promise<{
  isPrimary: boolean;
}> {
  const env = options.env ?? process.env;
  const { isPrimary } = applyUiSingleInstancePolicy({
    requestLock: options.ports.requestSingleInstanceLock,
    quit: options.ports.quit,
  });
  if (!isPrimary) {
    return { isPrimary: false };
  }

  const stateDir = resolveDesktopStateDir(env);
  const supervisor =
    options.supervisor ??
    createSupervisorDeps({
      stateDir,
      appRoot: options.appRoot,
      expectedProtocolVersion: protocolVersion,
      env,
    });
  const fetchImpl = options.fetchImpl ?? fetch;
  const grants = new WorkspaceGrantStore();
  const hub = new EventSubscriptionHub();
  let snapshot: ConnectionSnapshot = { status: "loading" };
  let session: SessionSecrets | null = null;
  let port: number | null = null;
  let windowPort: DesktopWindowPort | null = null;
  const push = ipcPushChannels();

  const sendToRenderer = (channel: string, payload: unknown): void => {
    if (windowPort && !windowPort.isDestroyed()) {
      windowPort.send(channel, payload);
    }
  };

  const setSnapshot = (next: ConnectionSnapshot): void => {
    assertNoSecretFields(next);
    snapshot = next;
    sendToRenderer(push.connectionChanged, next);
  };

  const sse = createDaemonSseBridge({
    getTarget: () => (port !== null && session ? { port, session } : null),
    send: (payload) => {
      sendToRenderer(push.event, payload);
    },
    fetchImpl,
  });

  const connect = async (): Promise<ConnectionSnapshot> => {
    setSnapshot({ status: "loading" });
    const result = await ensureDaemon(supervisor);
    if (!result.ok) {
      session = null;
      port = null;
      sse.stop();
      setSnapshot(result.snapshot);
      return result.snapshot;
    }
    port = result.state.port;
    try {
      session = await establishSessionFromStateDir(port, stateDir, fetchImpl);
    } catch (error) {
      session = null;
      const message =
        error instanceof Error ? error.message : "Failed to establish a daemon session";
      const errorSnapshot: ConnectionSnapshot = {
        status: "error",
        message,
        recoverable: true,
      };
      setSnapshot(errorSnapshot);
      return errorSnapshot;
    }
    setSnapshot(result.snapshot);
    for (const subscription of hub.list()) {
      void sse.start(subscription);
    }
    return result.snapshot;
  };

  options.ports.onSecondInstance(() => {
    if (windowPort && !windowPort.isDestroyed()) {
      focusExistingWindow(windowPort);
    }
  });

  options.ports.onWindowAllClosed(() => {
    applyLastWindowClose({
      quitUi: options.ports.quit,
      daemon: null,
    });
  });

  await options.ports.whenReady();
  await connect();

  const preloadPath = resolvePreloadPath(options.appRoot);
  const spec = createMainWindowSpec(preloadPath);
  windowPort = options.ports.createWindow(spec);
  windowPort.onClosed(() => {
    windowPort = null;
  });

  attachIpcHandlers(options.ports.handleIpc, {
    getConnection: async () => snapshot,
    reconnect: connect,
    requestApi: (input) =>
      proxyConnectedApiRequest(input, port === null ? null : { port, session }, fetchImpl),
    dialog: { pick: options.ports.pickDirectory },
    grants,
    subscriptions: {
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
    },
    quitUi: async () => {
      options.ports.quit();
    },
  });

  const load = resolveRendererLoadTarget(env, options.appRoot);
  if (load.kind === "url") {
    await windowPort.loadURL(load.target);
    windowPort.openDevTools?.();
  } else {
    await windowPort.loadFile(load.target);
  }

  return { isPrimary: true };
}
