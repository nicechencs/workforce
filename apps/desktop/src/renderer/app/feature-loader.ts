import { createShellRegistry } from "./feature-modules.js";

const featureGlob = import.meta.glob("../features/*/index.tsx", { eager: true });

export function loadRendererFeatureRegistry() {
  return createShellRegistry(featureGlob);
}
