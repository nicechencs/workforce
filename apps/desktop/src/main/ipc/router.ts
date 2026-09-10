import type { ApiRequest, ConnectionSnapshot, EventSubscribeRequest } from "@workforce/ui";

import {
  assertAllowedIpcInvokeChannel,
  IPC_INVOKE_CHANNELS,
  IpcAccessDeniedError,
  type IpcInvokeChannel,
} from "../../preload/contracts.js";
import { EventSubscriptionHub } from "./subscriptions.js";
import {
  pickWorkspaceDirectory,
  type DirectoryDialog,
  WorkspaceGrantStore,
} from "./workspace-picker.js";

export interface IpcRouterDeps {
  getConnection(): Promise<ConnectionSnapshot>;
  reconnect(): Promise<ConnectionSnapshot>;
  requestApi(input: ApiRequest): Promise<unknown>;
  dialog: DirectoryDialog;
  grants: WorkspaceGrantStore;
  subscriptions: EventSubscriptionHub;
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
      return deps.requestApi(payload as ApiRequest);
    case IPC_INVOKE_CHANNELS.eventsSubscribe: {
      const input = (payload ?? {}) as EventSubscribeRequest;
      const { subscription } = deps.subscriptions.subscribe(input);
      return { subscriptionId: subscription.subscriptionId };
    }
    case IPC_INVOKE_CHANNELS.eventsUnsubscribe: {
      const id = (payload as { subscriptionId?: string } | null)?.subscriptionId;
      if (typeof id === "string") {
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
