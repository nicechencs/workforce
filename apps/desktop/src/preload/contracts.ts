export const IPC_INVOKE_CHANNELS = {
  connectionGet: "workforce:connection:get",
  connectionReconnect: "workforce:connection:reconnect",
  apiRequest: "workforce:api:request",
  eventsSubscribe: "workforce:events:subscribe",
  eventsUnsubscribe: "workforce:events:unsubscribe",
  workspacePick: "workforce:workspace:pick",
  shellQuitUi: "workforce:shell:quit-ui",
} as const;

export type IpcInvokeChannel = (typeof IPC_INVOKE_CHANNELS)[keyof typeof IPC_INVOKE_CHANNELS];

export const IPC_PUSH_CHANNELS = {
  connectionChanged: "workforce:connection:changed",
  event: "workforce:events:message",
} as const;

export type IpcPushChannel = (typeof IPC_PUSH_CHANNELS)[keyof typeof IPC_PUSH_CHANNELS];

export const PRELOAD_WORLD_KEY = "workforce" as const;

const invokeChannelSet = new Set<string>(Object.values(IPC_INVOKE_CHANNELS));
const pushChannelSet = new Set<string>(Object.values(IPC_PUSH_CHANNELS));

export function isAllowedIpcInvokeChannel(channel: string): channel is IpcInvokeChannel {
  return invokeChannelSet.has(channel);
}

export function isAllowedIpcPushChannel(channel: string): channel is IpcPushChannel {
  return pushChannelSet.has(channel);
}

export class IpcAccessDeniedError extends Error {
  readonly code = "ipc_denied" as const;

  constructor(readonly channel: string) {
    super(`IPC channel is not on the preload whitelist: ${channel}`);
    this.name = "IpcAccessDeniedError";
  }
}

export function assertAllowedIpcInvokeChannel(channel: string): IpcInvokeChannel {
  if (!isAllowedIpcInvokeChannel(channel)) {
    throw new IpcAccessDeniedError(channel);
  }
  return channel;
}
