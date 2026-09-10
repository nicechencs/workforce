import type { WorkforceFeatureModule } from "../contract.js";
import { NodesPage } from "./page.js";

export const feature: WorkforceFeatureModule = {
  slot: "nodes",
  title: "执行节点",
  Page: NodesPage,
};
