import { createContext, useContext, type ReactNode } from "react";

import type { CapabilitiesDto, DesktopClient } from "@workforce/desktop-client";
import type { ConnectionSnapshot } from "@workforce/ui";

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

export function useWorkforceClient(): DesktopClient {
  return useWorkforceContext().client;
}

export function useWorkforceConnection(): ConnectionSnapshot {
  return useWorkforceContext().connection;
}

export function useWorkforceNavigate(): (path: string) => void {
  return useWorkforceContext().navigate;
}

export function useWorkforceCapabilities(): CapabilitiesDto | null {
  return useWorkforceContext().capabilities;
}
