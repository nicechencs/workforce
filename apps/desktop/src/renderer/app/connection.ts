import {
  bannerForConnection,
  connectionAllowsNavigation,
  overlayForConnection,
  type ConnectionSnapshot,
} from "@workforce/ui";

export interface ConnectionController {
  getState(): Promise<ConnectionSnapshot>;
  reconnect(): Promise<ConnectionSnapshot>;
  subscribe(listener: (state: ConnectionSnapshot) => void): () => void;
}

export function describeConnection(snapshot: ConnectionSnapshot): {
  snapshot: ConnectionSnapshot;
  canNavigate: boolean;
  overlay: "loading" | null;
} {
  return {
    snapshot,
    canNavigate: connectionAllowsNavigation(snapshot),
    overlay: overlayForConnection(snapshot),
  };
}

export { bannerForConnection };
