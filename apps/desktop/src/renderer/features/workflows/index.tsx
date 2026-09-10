import type { WorkforceFeatureModule } from "../contract.js";
import { WorkflowsPage } from "./page.js";

export const feature: WorkforceFeatureModule = {
  slot: "workflows",
  title: "工作流",
  Page: WorkflowsPage,
};

export { WorkflowsPage };
