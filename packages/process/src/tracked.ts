import type { ChildProcess } from "node:child_process";

export type TrackedProcess = {
  handle: { pid: number; startIdentity: string };
  platform: "win32" | "posix";
  descendants: Array<{ pid: number; startIdentity: string }>;
  usedJob: boolean;
  closeFlag?: string;
  helper?: ChildProcess;
  child?: ChildProcess;
  dir?: string;
};
