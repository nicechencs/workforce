import type { WorkforceFeatureModule } from "../features/contract.js";
import { createRouteRegistry, type FeatureModule, type RouteRegistry } from "../routes/registry.js";

export function loadFeatureModules(glob: Record<string, unknown>): FeatureModule[] {
  const loaded: FeatureModule[] = [];
  for (const mod of Object.values(glob)) {
    if (typeof mod !== "object" || mod === null || !("feature" in mod)) {
      continue;
    }
    const feature = (mod as { feature?: WorkforceFeatureModule }).feature;
    if (!feature || typeof feature.slot !== "string" || typeof feature.Page !== "function") {
      continue;
    }
    const next: FeatureModule = { slot: feature.slot, Page: feature.Page };
    if (feature.title !== undefined) {
      next.title = feature.title;
    }
    loaded.push(next);
  }
  return loaded;
}

export function createShellRegistry(glob: Record<string, unknown> = {}): RouteRegistry {
  const registry = createRouteRegistry();
  for (const module of loadFeatureModules(glob)) {
    registry.registerFeatureModule(module);
  }
  return registry;
}

export function shouldRenderFeaturePage(
  resolved: { featureRegistered: boolean } | null,
  page: FeatureModule["Page"] | undefined,
): boolean {
  return resolved?.featureRegistered === true && typeof page === "function";
}
