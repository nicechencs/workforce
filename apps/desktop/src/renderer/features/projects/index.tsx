import type { WorkforceFeatureModule } from "../contract.js";
import { ProjectsPage } from "./page.js";

export const feature: WorkforceFeatureModule = {
  slot: "projects",
  title: "项目",
  Page: ProjectsPage,
};

export { ProjectsPage };
