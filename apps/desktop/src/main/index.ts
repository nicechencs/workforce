export const processRole = "main" as const;

export {
  desktopUiSingleInstancePolicy,
  electronWindowAllClosedPolicy,
  handleLastWindowClose,
  LAST_WINDOW_CLOSE_POLICY,
} from "./app-lifecycle/index.js";
export {
  canSpawnReplacement,
  classifyLaunchFailure,
  DAEMON_MUTEX_NAME,
  daemonDiagnosticSnapshotPath,
  daemonDiagnosticsDir,
  daemonStderrLogPath,
  detachedDaemonSpawnOptions,
  ensureDaemon,
  handshakeProtocolVersion,
  inspectExistingDaemon,
  redactDiagnosticText,
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
export {
  applyLastWindowClose,
  applyUiSingleInstancePolicy,
  attachIpcHandlers,
  resolvePreloadPath,
  resolveRendererLoadTarget,
} from "./composition.js";
export { startDesktopApp } from "./start.js";
export type { DesktopAppPorts, DesktopWindowPort, StartDesktopOptions } from "./start.js";
export {
  createSupervisorDeps,
  desktopDiagnosticPaths,
  resolveDaemonEntry,
  resolveDesktopStateDir,
} from "./supervisor-runtime.js";
export {
  DESKTOP_SMOKE_ENV,
  isDesktopSmokeEnabled,
  resolveDaemonLaunchArgs,
  resolveSmokeDirectoryOverride,
  resolveSmokeWorkspacePath,
  shouldLaunchElectronHeadless,
} from "./smoke-env.js";
