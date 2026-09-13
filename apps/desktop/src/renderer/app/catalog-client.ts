import type { CommandOptions, DesktopClient, ListQuery, PageDto } from "@workforce/desktop-client";

export type CatalogClient = {
  listTeams?: (query?: ListQuery) => Promise<PageDto<unknown>>;
  getTeam?: (id: string) => Promise<unknown>;
  listWorkflows?: (query?: ListQuery) => Promise<PageDto<unknown>>;
  getWorkflow?: (id: string) => Promise<unknown>;
  listRuntimes?: () => Promise<PageDto<unknown>>;
  listNodes?: () => Promise<PageDto<unknown>>;
  getProjectBudget?: (id: string) => Promise<unknown>;
  createProjectWorkspace?: (
    projectId: string,
    input: { authorizationRef: string },
    options: CommandOptions,
  ) => Promise<unknown>;
};

export function asCatalogClient(client: DesktopClient): CatalogClient {
  return client as unknown as CatalogClient;
}

export function hasCatalogMethod<K extends keyof CatalogClient>(
  client: CatalogClient,
  name: K,
): client is CatalogClient & Required<Pick<CatalogClient, K>> {
  return typeof client[name] === "function";
}
