import type { WorkforceFeatureModule } from "../contract.js";
import { TeamsPage } from "./page.js";

export const feature: WorkforceFeatureModule = {
  slot: "teams",
  title: "AI 团队",
  Page: TeamsPage,
};

export { ProjectTeamBindingField, TeamsPage } from "./page.js";
export {
  bindProjectToPublishedTeamVersion,
  isTeamReadyForPlanning,
  loadPublishedTeamCatalog,
} from "./model.js";
