import { useEffect, useState } from "react";
import type { DesktopClient } from "@workforce/desktop-client";
import type { ConnectionSnapshot } from "@workforce/ui";

import {
  getInjectedConnectionForTests,
  getPreloadApi,
  getWorkforceClient as getFallbackClient,
  setWorkforceClientForTests as setFallbackClient,
  setWorkforceConnectionForTests as setFallbackConnection,
} from "./_client-fallback.js";

export {
  asCatalogClient,
  createPreloadTransport,
  getPreloadApi,
  getWorkforceClient,
  hasCatalogMethod,
} from "./_client-fallback.js";
export type { CatalogClient } from "./_client-fallback.js";

/**
 * T11 will provide `../../app/workforce-context.js`. This worktree does not
 * include that module, so pages compile against the local fallback.
 */
const WORKFORCE_CONTEXT_MODULE = "../../app/workforce-context.js";

type AppContextHooks = {
  useWorkforceClient: () => DesktopClient;
  useWorkforceConnection: () => ConnectionSnapshot;
};

function tryAppContext(): AppContextHooks | null {
  void WORKFORCE_CONTEXT_MODULE;
  return null;
}

const appContext = tryAppContext();

export function setWorkforceClientForTests(client: DesktopClient | null): void {
  setFallbackClient(client);
}

export function setWorkforceConnectionForTests(snapshot: ConnectionSnapshot | undefined): void {
  setFallbackConnection(snapshot);
}

export function useWorkforceClient(): DesktopClient {
  if (appContext) {
    return appContext.useWorkforceClient();
  }
  return getFallbackClient();
}

export function useWorkforceConnection(): ConnectionSnapshot {
  if (appContext) {
    return appContext.useWorkforceConnection();
  }
  const injected = getInjectedConnectionForTests();
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot>(injected ?? { status: "loading" });
  useEffect(() => {
    if (injected !== undefined) {
      setSnapshot(injected);
      return;
    }
    const api = getPreloadApi();
    if (!api) {
      setSnapshot({ status: "offline" });
      return;
    }
    void api.connection.getState().then(setSnapshot);
    return api.connection.subscribe(setSnapshot);
  }, [injected]);
  return snapshot;
}
