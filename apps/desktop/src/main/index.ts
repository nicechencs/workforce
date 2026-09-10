export const processRole = "main" as const;

export {
  desktopUiSingleInstancePolicy,
  electronWindowAllClosedPolicy,
  handleLastWindowClose,
  LAST_WINDOW_CLOSE_POLICY,
} from "./app-lifecycle/index.js";
export {
  canSpawnReplacement,
  DAEMON_MUTEX_NAME,
  detachedDaemonSpawnOptions,
  ensureDaemon,
  handshakeProtocolVersion,
  inspectExistingDaemon,
  spawnDetachedDaemon,
} from "./daemon-supervisor/index.js";
export {
  API_ROUTE_TEMPLATES,
  assertSafeApiRequest,
  dispatchIpc,
  EventSubscriptionHub,
  isAllowedApiRequest,
  WorkspaceGrantStore,
} from "./ipc/index.js";
export { requiredCoordinatorDependencies } from "./required-dependencies.js";
export { assertSecureWebPreferences, createRendererWebPreferences } from "./security.js";
export { decideDaemonUpgrade } from "./updater/index.js";
export { createMainWindowSpec } from "./windows/index.js";
