import { protocolVersion } from "@workforce/protocol";

import {
  applyLastWindowClose,
  applyUiSingleInstancePolicy,
  attachIpcHandlers,
  focusExistingWindow,
  proxyConnectedApiRequest,
  resolvePreloadPath,
  resolveRendererLoadTarget,
} from "./composition.js";
import { createDesktopRuntimeSession } from "./desktop-connection.js";
import {
  unknownWorkspaceGrantResponse,
  WorkspaceGrantStore,
} from "./ipc/workspace-picker.js";
import { createSupervisorDeps, resolveDesktopStateDir } from "./supervisor-runtime.js";
import { createMainWindowSpec, type BrowserWindowSpec } from "./windows/factory.js";
import { runDesktopMainPathSmoke } from "./smoke-driver.js";
import {
  isDesktopSmokeEnabled,
  isDesktopSmokeHeaded,
  resolveSmokeResultPath,
} from "./smoke-env.js";
import type { SupervisorDeps } from "./daemon-supervisor/types.js";

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
  executeJavaScript?(code: string): Promise<unknown>;
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
  let windowPort: DesktopWindowPort | null = null;

  const runtime = createDesktopRuntimeSession({
    supervisor,
    stateDir,
    fetchImpl,
    send: (channel, payload) => {
      if (windowPort && !windowPort.isDestroyed()) {
        windowPort.send(channel, payload);
      }
    },
  });

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
  await runtime.connect();

  const preloadPath = resolvePreloadPath(options.appRoot);
  const spec = createMainWindowSpec(preloadPath, {
    show: !isDesktopSmokeEnabled(env) || isDesktopSmokeHeaded(env),
  });
  windowPort = options.ports.createWindow(spec);
  windowPort.onClosed(() => {
    runtime.dispose();
    windowPort = null;
  });

  attachIpcHandlers(options.ports.handleIpc, {
    getConnection: async () => runtime.getSnapshot(),
    reconnect: () => runtime.connect(),
    requestApi: async (input) => {
      const denied = unknownWorkspaceGrantResponse(input, grants);
      if (denied !== null) {
        return denied;
      }
      return proxyConnectedApiRequest(input, runtime.loopback(), fetchImpl);
    },
    dialog: { pick: options.ports.pickDirectory },
    grants,
    subscriptions: {
      subscribe: (input) => runtime.subscribe(input),
      unsubscribe: (id) => runtime.unsubscribe(id),
    },
    quitUi: async () => {
      options.ports.quit();
    },
  });

  const load = resolveRendererLoadTarget(env, options.appRoot);
  if (load.kind === "url") {
    await windowPort.loadURL(load.target);
    if (!isDesktopSmokeEnabled(env)) {
      windowPort.openDevTools?.();
    }
  } else {
    await windowPort.loadFile(load.target);
  }

  if (isDesktopSmokeEnabled(env)) {
    const resultPath = resolveSmokeResultPath(env);
    if (!resultPath) {
      throw new Error("WORKFORCE_DESKTOP_SMOKE_OUT is required when WORKFORCE_DESKTOP_SMOKE=1");
    }
    const executeJavaScript = windowPort.executeJavaScript;
    if (!executeJavaScript) {
      throw new Error("Desktop smoke requires executeJavaScript on the window port");
    }
    await runDesktopMainPathSmoke({
      executeJavaScript,
      resultPath,
      quit: options.ports.quit,
    });
  }

  return { isPrimary: true };
}
