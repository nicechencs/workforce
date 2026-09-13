import type { WorkforceFeatureModule } from "../contract.js";
import { ChatPage } from "./page.js";

export const feature: WorkforceFeatureModule = {
  slot: "chat",
  title: "Chat",
  Page: ChatPage,
};
