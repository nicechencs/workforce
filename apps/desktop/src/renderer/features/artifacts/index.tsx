import type { WorkforceFeatureModule } from "../contract.js";
import { ArtifactsPage } from "./page.js";

export const feature: WorkforceFeatureModule = {
  slot: "artifacts",
  title: "产物",
  Page: ArtifactsPage,
};
