import type {
  ApiRequest,
  ConnectionSnapshot,
  EventSubscribeRequest,
  WorkforcePreloadApi,
} from "@workforce/ui";

import {
  assertAllowedIpcInvokeChannel,
  IPC_INVOKE_CHANNELS,
  IPC_PUSH_CHANNELS,
  isAllowedIpcPushChannel,
  PRELOAD_WORLD_KEY,
  type IpcPushChannel,
} from "./contracts.js";

export interface IpcRendererPort {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
}

export interface ContextBridgePort {
  exposeInMainWorld(key: typeof PRELOAD_WORLD_KEY, api: WorkforcePreloadApi): void;
}

function invokeAllowed(ipc: IpcRendererPort, channel: string, payload?: unknown): Promise<unknown> {
  return ipc.invoke(assertAllowedIpcInvokeChannel(channel), payload);
}

function onAllowed(
  ipc: IpcRendererPort,
  channel: IpcPushChannel,
  listener: (payload: unknown) => void,
): () => void {
  if (!isAllowedIpcPushChannel(channel)) {
    throw new Error(`Push channel is not allowed: ${channel}`);
  }
  return ipc.on(channel, listener);
}

export function createPreloadApi(ipc: IpcRendererPort): WorkforcePreloadApi {
  return {
    connection: {
      getState: () =>
        invokeAllowed(ipc, IPC_INVOKE_CHANNELS.connectionGet) as Promise<ConnectionSnapshot>,
      reconnect: () =>
        invokeAllowed(ipc, IPC_INVOKE_CHANNELS.connectionReconnect) as Promise<ConnectionSnapshot>,
      subscribe: (listener) =>
        onAllowed(ipc, IPC_PUSH_CHANNELS.connectionChanged, (payload) => {
          listener(payload as ConnectionSnapshot);
        }),
    },
    api: {
      request: (input: ApiRequest) =>
        invokeAllowed(ipc, IPC_INVOKE_CHANNELS.apiRequest, input) as ReturnType<
          WorkforcePreloadApi["api"]["request"]
        >,
      subscribeEvents: (input: EventSubscribeRequest) =>
        invokeAllowed(ipc, IPC_INVOKE_CHANNELS.eventsSubscribe, input) as ReturnType<
          WorkforcePreloadApi["api"]["subscribeEvents"]
        >,
      unsubscribeEvents: (subscriptionId: string) =>
        invokeAllowed(ipc, IPC_INVOKE_CHANNELS.eventsUnsubscribe, {
          subscriptionId,
        }) as Promise<void>,
      onEvent: (listener) => onAllowed(ipc, IPC_PUSH_CHANNELS.event, listener),
    },
    workspace: {
      pickDirectory: () =>
        invokeAllowed(ipc, IPC_INVOKE_CHANNELS.workspacePick) as ReturnType<
          WorkforcePreloadApi["workspace"]["pickDirectory"]
        >,
    },
    shell: {
      quitUi: () => invokeAllowed(ipc, IPC_INVOKE_CHANNELS.shellQuitUi) as Promise<void>,
    },
  };
}

export function installPreloadBridge(bridge: ContextBridgePort, ipc: IpcRendererPort): void {
  bridge.exposeInMainWorld(PRELOAD_WORLD_KEY, createPreloadApi(ipc));
}
