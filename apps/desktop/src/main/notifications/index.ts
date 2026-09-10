export const moduleName = "notifications" as const;

export interface DesktopNotification {
  title: string;
  body: string;
}

export function canShowNotification(input: DesktopNotification): boolean {
  return input.title.length > 0 && input.body.length > 0;
}
