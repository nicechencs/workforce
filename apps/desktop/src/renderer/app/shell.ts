import { buildShellView, type ConnectionSnapshot, type ShellView } from "@workforce/ui";

export function renderShell(input: {
  connection: ConnectionSnapshot;
  currentPath: string;
}): ShellView {
  return buildShellView(input);
}
