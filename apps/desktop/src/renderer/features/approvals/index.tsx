import type { WorkforceFeatureModule } from "../contract.js";
import { ApprovalsPage } from "./page.js";

export const feature: WorkforceFeatureModule = {
  slot: "approvals",
  title: "审批中心",
  Page: ApprovalsPage,
};
