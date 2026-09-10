import type { WorkforceFeatureModule } from "../contract.js";
import { TeamsPage } from "./page.js";

export const feature: WorkforceFeatureModule = {
  slot: "teams",
  title: "AI 团队",
  Page: TeamsPage,
};

export { TeamsPage };
