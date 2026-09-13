import type { DesktopClient } from "@workforce/desktop-client";
import type { ConnectionSnapshot } from "@workforce/ui";

import {
  setWorkforceClientForTests as setCanonicalClient,
  setWorkforceConnectionForTests as setCanonicalConnection,
} from "../app/renderer-client.js";

export {
  asCatalogClient,
  hasCatalogMethod,
} from "../app/catalog-client.js";
export type { CatalogClient } from "../app/catalog-client.js";
export {
  createPreloadTransport,
  getPreloadApi,
  getWorkforceClient,
} from "../app/renderer-client.js";
export {
  useWorkforceCapabilities,
  useWorkforceClient,
  useWorkforceConnection,
  useWorkforceNavigate,
} from "../app/workforce-context.js";

export function setWorkforceClientForTests(client: DesktopClient | null): void {
  setCanonicalClient(client);
}

export function setWorkforceConnectionForTests(snapshot: ConnectionSnapshot | undefined): void {
  setCanonicalConnection(snapshot);
}
