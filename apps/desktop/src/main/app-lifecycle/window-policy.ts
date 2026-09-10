export const LAST_WINDOW_CLOSE_POLICY = {
  killDaemon: false,
  taskkillTree: false,
  quitUi: true,
} as const;

export interface DaemonKillHandle {
  kill: () => void;
}

export function handleLastWindowClose(daemon: DaemonKillHandle | null): {
  daemonKilled: false;
  quitUi: true;
} {
  void daemon;
  return { daemonKilled: false, quitUi: true };
}

export function electronWindowAllClosedPolicy(): {
  action: "quit-ui-keep-daemon";
  killDaemon: false;
  useUtilityProcess: false;
} {
  return {
    action: "quit-ui-keep-daemon",
    killDaemon: false,
    useUtilityProcess: false,
  };
}
