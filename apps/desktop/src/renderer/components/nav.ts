import {
  connectionAllowsNavigation,
  primaryNavItems,
  type ConnectionSnapshot,
} from "@workforce/ui";

export function shellNav(connection: ConnectionSnapshot, currentPath: string) {
  const enabled = connectionAllowsNavigation(connection);
  return primaryNavItems().map((item) => ({
    ...item,
    enabled,
    current: item.path === currentPath,
  }));
}
