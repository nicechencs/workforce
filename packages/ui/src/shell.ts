import { bannerForConnection, overlayForConnection, type BannerModel } from "./banners.js";
import { connectionAllowsNavigation, type ConnectionSnapshot } from "./connection.js";
import { primaryNavItems, type ShellNavItem } from "./nav.js";

export interface ShellNavView extends ShellNavItem {
  enabled: boolean;
  current: boolean;
}

export interface ShellView {
  title: string;
  connection: ConnectionSnapshot;
  nav: ShellNavView[];
  banner: BannerModel | null;
  overlay: "loading" | null;
  mainEnabled: boolean;
}

export function buildShellView(input: {
  connection: ConnectionSnapshot;
  currentPath: string;
  title?: string;
}): ShellView {
  const mainEnabled = connectionAllowsNavigation(input.connection);
  return {
    title: input.title ?? "Workforce",
    connection: input.connection,
    nav: primaryNavItems().map((item) => ({
      ...item,
      enabled: mainEnabled,
      current: item.path === input.currentPath,
    })),
    banner: bannerForConnection(input.connection),
    overlay: overlayForConnection(input.connection),
    mainEnabled,
  };
}
