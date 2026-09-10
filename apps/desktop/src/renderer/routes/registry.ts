import type { FeatureSlot } from "@workforce/ui";

import { SHELL_ROUTES, type ShellRoute } from "./catalog.js";

export interface FeatureModule {
  slot: FeatureSlot;
  title?: string;
}

export interface ResolvedRoute {
  route: ShellRoute;
  params: Record<string, string>;
  featureRegistered: boolean;
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (pattern === "/" && (path === "/" || path === "")) {
    return {};
  }
  if (patternParts.length !== pathParts.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i];
    const actual = pathParts[i];
    if (expected === undefined || actual === undefined) {
      return null;
    }
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = actual;
      continue;
    }
    if (expected !== actual) {
      return null;
    }
  }
  return params;
}

export function createRouteRegistry(initial: readonly ShellRoute[] = SHELL_ROUTES) {
  const routes = [...initial];
  const modules = new Map<FeatureSlot, FeatureModule>();

  return {
    registerFeatureModule(module: FeatureModule): void {
      modules.set(module.slot, module);
    },
    list(): ShellRoute[] {
      return [...routes];
    },
    resolve(path: string): ResolvedRoute | null {
      for (const route of routes) {
        const params = matchPath(route.path, path);
        if (params) {
          return {
            route,
            params,
            featureRegistered: modules.has(route.slot),
          };
        }
      }
      return null;
    },
    isFeatureRegistered(slot: FeatureSlot): boolean {
      return modules.has(slot);
    },
  };
}

export type RouteRegistry = ReturnType<typeof createRouteRegistry>;
