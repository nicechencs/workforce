import type { WorkforceFeatureModule } from "../contract.js";
import { SettingsPage } from "./page.js";

export const feature: WorkforceFeatureModule = {
  slot: "settings",
  title: "设置",
  Page: SettingsPage,
};
