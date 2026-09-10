import { useEffect, useState } from "react";
import type { DesktopClient } from "@workforce/desktop-client";
import type { ConnectionSnapshot } from "@workforce/ui";

import { useOptionalWorkforceContext } from "../app/workforce-context.js";
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

export function setWorkforceClientForTests(client: DesktopClient | null): void {
  setFallbackClient(client);
}

export function setWorkforceConnectionForTests(snapshot: ConnectionSnapshot | undefined): void {
  setFallbackConnection(snapshot);
}

export function useWorkforceClient(): DesktopClient {
  const ctx = useOptionalWorkforceContext();
  if (ctx) {
    return ctx.client;
  }
  return getFallbackClient();
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
