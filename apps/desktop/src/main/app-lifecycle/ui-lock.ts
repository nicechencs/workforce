export const DESKTOP_UI_LOCK_NAME = "WorkforceDesktop" as const;

export function desktopUiSingleInstancePolicy(): {
  requestSingleInstanceLock: true;
  secondInstanceBehavior: "focus-existing";
  locksDaemon: false;
} {
  return {
    requestSingleInstanceLock: true,
    secondInstanceBehavior: "focus-existing",
    locksDaemon: false,
  };
}
