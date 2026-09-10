import type { FeatureSlot } from "@workforce/ui";
import type { ReactNode } from "react";

/**
 * T12/T13 feature entry contract. T11 glob-loads
 * features/<slot>/index.tsx and registers `feature`.
 * Do not edit catalog.ts or this file from T12/T13.
 */
export interface FeaturePageProps {
  params: Record<string, string>;
  path: string;
  navigate: (path: string) => void;
}

export interface WorkforceFeatureModule {
  slot: FeatureSlot;
  title?: string;
  Page: (props: FeaturePageProps) => ReactNode;
}
