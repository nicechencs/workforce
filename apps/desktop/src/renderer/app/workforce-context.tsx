import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import type { CapabilitiesDto, DesktopClient } from "@workforce/desktop-client";
import type { ConnectionSnapshot } from "@workforce/ui";

import {
  getInjectedConnectionForTests,
  getPreloadApi,
  getWorkforceClient,
} from "./renderer-client.js";

export interface WorkforceContextValue {
  client: DesktopClient;
  connection: ConnectionSnapshot;
  navigate: (path: string) => void;
  capabilities: CapabilitiesDto | null;
}

const WorkforceContext = createContext<WorkforceContextValue | null>(null);

export function WorkforceProvider(props: {
  value: WorkforceContextValue;
  children: ReactNode;
}): ReactNode {
  return (
    <WorkforceContext.Provider value={props.value}>{props.children}</WorkforceContext.Provider>
  );
}

export function useOptionalWorkforceContext(): WorkforceContextValue | null {
  return useContext(WorkforceContext);
}

function useWorkforceContext(): WorkforceContextValue {
  const value = useOptionalWorkforceContext();
  if (!value) {
    throw new Error("Workforce context is unavailable outside the desktop shell");
  }
  return value;
}

/** Shell Provider 优先；测试或孤立页面回退到同一生产 DesktopClient。 */
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

export function useWorkforceNavigate(): (path: string) => void {
  return useWorkforceContext().navigate;
}

export function useWorkforceCapabilities(): CapabilitiesDto | null {
  return useOptionalWorkforceContext()?.capabilities ?? null;
}
