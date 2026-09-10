import type { WorkforceFeatureModule } from "../contract.js";
import { RunsPage } from "./page.js";

export const feature: WorkforceFeatureModule = {
  slot: "runs",
  title: "运行记录",
  Page: RunsPage,
};
