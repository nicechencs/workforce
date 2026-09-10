import type { WorkforcePreloadApi } from "@workforce/ui";

declare global {
  interface Window {
    workforce: WorkforcePreloadApi;
  }
}

export {};
