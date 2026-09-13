import type { WorkforceFeatureModule } from "../contract.js";
import { RoleLibraryPage } from "./page.js";

export const feature: WorkforceFeatureModule = {
  slot: "role-library",
  title: "角色版本库",
  Page: RoleLibraryPage,
};

export { RoleLibraryPage } from "./page.js";
