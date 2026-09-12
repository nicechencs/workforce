import { useEffect, useState } from "react";
import type { DesktopClient } from "@workforce/desktop-client";
import type { ConnectionSnapshot } from "@workforce/ui";

import {
  getInjectedConnectionForTests,
  getPreloadApi,
  getWorkforceClient,
  setWorkforceClientForTests as setCanonicalClient,
  setWorkforceConnectionForTests as setCanonicalConnection,
} from "../app/renderer-client.js";
import { useOptionalWorkforceContext } from "../app/workforce-context.js";

export {
  asCatalogClient,
  createPreloadTransport,
  hasCatalogMethod,
} from "./_client-fallback.js";
export type { CatalogClient } from "./_client-fallback.js";
export { getPreloadApi, getWorkforceClient };

export function setWorkforceClientForTests(client: DesktopClient | null): void {
  setCanonicalClient(client);
}

export function setWorkforceConnectionForTests(snapshot: ConnectionSnapshot | undefined): void {
  setCanonicalConnection(snapshot);
}

export function useWorkforceClient(): DesktopClient {
  const ctx = useOptionalWorkforceContext();
  if (ctx) {
    return ctx.client;
  }
  return getWorkforceClient();
}

export function useWorkforceConnection(): ConnectionSnapshot {
  const ctx = useOptionalWorkforceContext();
  const injected = getInjectedConnectionForTests();
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot>(injected ?? { status: "loading" });
  const inShell = ctx !== null;
  useEffect(() => {
    if (inShell) {
      return;
    }
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
  }, [inShell, injected]);
  return ctx?.connection ?? snapshot;
}
