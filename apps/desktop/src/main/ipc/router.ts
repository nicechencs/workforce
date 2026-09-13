import type { ApiRequest, ConnectionSnapshot } from "@workforce/ui";

import {
  assertAllowedIpcInvokeChannel,
  IPC_INVOKE_CHANNELS,
  IpcAccessDeniedError,
  type IpcInvokeChannel,
} from "../../preload/contracts.js";
import { readApiRequest } from "./allowlist.js";
import {
  parseEventSubscribeInput,
  readSubscriptionId,
  type EventSubscribeInput,
  type LiveSubscription,
} from "./subscriptions.js";
import {
  pickWorkspaceDirectory,
  type DirectoryDialog,
  WorkspaceGrantStore,
} from "./workspace-picker.js";

export interface EventSubscriptionPort {
  subscribe(input: EventSubscribeInput): { subscription: LiveSubscription; created: boolean };
  unsubscribe(subscriptionId: string): boolean;
}

export interface IpcRouterDeps {
  getConnection(): Promise<ConnectionSnapshot>;
  reconnect(): Promise<ConnectionSnapshot>;
  requestApi(input: ApiRequest): Promise<unknown>;
  dialog: DirectoryDialog;
  grants: WorkspaceGrantStore;
  subscriptions: EventSubscriptionPort;
  quitUi(): Promise<void>;
}

export async function dispatchIpc(
  channel: string,
  payload: unknown,
  deps: IpcRouterDeps,
): Promise<unknown> {
  let allowed: IpcInvokeChannel;
  try {
    allowed = assertAllowedIpcInvokeChannel(channel);
  } catch (error) {
    if (error instanceof IpcAccessDeniedError) {
      throw error;
    }
    throw new IpcAccessDeniedError(channel);
  }

  switch (allowed) {
    case IPC_INVOKE_CHANNELS.connectionGet:
      return deps.getConnection();
    case IPC_INVOKE_CHANNELS.connectionReconnect:
      return deps.reconnect();
    case IPC_INVOKE_CHANNELS.apiRequest:
      return deps.requestApi(readApiRequest(payload));
    case IPC_INVOKE_CHANNELS.eventsSubscribe: {
      const { subscription } = deps.subscriptions.subscribe(parseEventSubscribeInput(payload));
      return { subscriptionId: subscription.subscriptionId };
    }
    case IPC_INVOKE_CHANNELS.eventsUnsubscribe: {
      const id = readSubscriptionId(payload);
      if (id !== undefined) {
        deps.subscriptions.unsubscribe(id);
      }
      return { ok: true };
    }
    case IPC_INVOKE_CHANNELS.workspacePick:
      return pickWorkspaceDirectory(deps.dialog, deps.grants);
    case IPC_INVOKE_CHANNELS.shellQuitUi:
      await deps.quitUi();
      return { ok: true };
  }
}
