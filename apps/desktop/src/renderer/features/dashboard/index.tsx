import type { WorkforceFeatureModule } from "../contract.js";
import { DashboardPage } from "./page.js";

export const feature: WorkforceFeatureModule = {
  slot: "dashboard",
  title: "工作台",
  Page: DashboardPage,
};
