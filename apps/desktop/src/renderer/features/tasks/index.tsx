import type { WorkforceFeatureModule } from "../contract.js";
import { TasksPage } from "./page.js";

export const feature: WorkforceFeatureModule = {
  slot: "tasks",
  title: "任务详情",
  Page: TasksPage,
};

export { TasksPage };
