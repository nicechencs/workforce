import { spawn } from "node:child_process";
import {
  DEFAULT_LOCK_PORT,
  defaultStateDir,
  daemonScript,
  parseArgs,
  emit,
  wait,
} from "./shared.mjs";

process.title = "workforce-spike-holder";

const args = parseArgs();
const stateDir = args["state-dir"] ? String(args["state-dir"]) : defaultStateDir();
const lockPort = Number(args["lock-port"] ?? DEFAULT_LOCK_PORT);
const detached = args.detached === "true" || args.detached === true;
const exitAfterMs = args["exit-after-ms"] != null ? Number(args["exit-after-ms"]) : 0;

const child = spawn(
  process.execPath,
  [daemonScript(), "--state-dir", stateDir, "--lock-port", String(lockPort)],
  {
    detached,
    stdio: "ignore",
    windowsHide: true,
  },
);

emit("holder-spawned", {
  holderPid: process.pid,
  daemonPid: child.pid,
  detached,
});

if (exitAfterMs > 0) {
  await wait(exitAfterMs);
  emit("holder-exiting", { killChild: false, daemonPid: child.pid });
  process.exit(0);
}

await new Promise(() => {
  // Stay alive until killed (experiment F2).
});
