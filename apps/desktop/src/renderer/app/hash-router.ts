export function parseHashPath(hash: string): string {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  const withoutQuery = trimmed.split("?")[0] ?? "";
  if (withoutQuery.length === 0) {
    return "/";
  }
  const withSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  if (withSlash.length > 1 && withSlash.endsWith("/")) {
    return withSlash.slice(0, -1);
  }
  return withSlash;
}

export function parseHashQuery(hash: string): URLSearchParams {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  const query = trimmed.includes("?") ? (trimmed.split("?")[1] ?? "") : "";
  return new URLSearchParams(query);
}

export function pathToHash(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `#${normalized}`;
}

export function slotForHash(
  hash: string,
  registry: { resolve(path: string): { route: { slot: string } } | null },
): string | null {
  return registry.resolve(parseHashPath(hash))?.route.slot ?? null;
}
