export const processRole = "preload" as const;

export {
  assertAllowedIpcInvokeChannel,
  IPC_INVOKE_CHANNELS,
  IPC_PUSH_CHANNELS,
  IpcAccessDeniedError,
  isAllowedIpcInvokeChannel,
  isAllowedIpcPushChannel,
  PRELOAD_WORLD_KEY,
} from "./contracts.js";
export type { IpcInvokeChannel, IpcPushChannel } from "./contracts.js";
export { createPreloadApi, installPreloadBridge } from "./bridge.js";
export type { ContextBridgePort, IpcRendererPort } from "./bridge.js";
