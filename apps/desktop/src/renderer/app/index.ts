export { describeConnection } from "./connection.js";
export type { ConnectionController } from "./connection.js";
export { renderShell } from "./shell.js";
export {
  WorkforceProvider,
  useWorkforceCapabilities,
  useWorkforceClient,
  useWorkforceConnection,
  useWorkforceNavigate,
} from "./workforce-context.js";
export type { WorkforceContextValue } from "./workforce-context.js";
export { createIpcTransport } from "./ipc-transport.js";
export { parseHashPath, pathToHash, slotForHash } from "./hash-router.js";
export {
  createShellRegistry,
  loadFeatureModules,
  shouldRenderFeaturePage,
} from "./feature-modules.js";
