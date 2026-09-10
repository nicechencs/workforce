import { buildShellView, type ConnectionSnapshot, type ShellView } from "@workforce/ui";

export function renderShell(input: {
  connection: ConnectionSnapshot;
  currentPath: string;
  title?: string;
}): ShellView {
  return buildShellView(input);
}
