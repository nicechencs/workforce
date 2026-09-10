import { startDaemon, parseDaemonArgs, isEntrypoint } from "./bootstrap/index.js";

export const packageName = "@workforce/daemon" as const;
export { startDaemon, parseDaemonArgs, isEntrypoint } from "./bootstrap/index.js";
export type { DaemonOptions, StartedDaemon } from "./bootstrap/index.js";
export { FakeAppServices } from "./modules/fake-app-services.js";
export type { AppServices } from "./modules/index.js";

async function main(): Promise<void> {
  const args = parseDaemonArgs(process.argv.slice(2));
  if (!args.stateDir) {
    process.stderr.write("daemon: --state-dir is required\n");
    process.exit(2);
  }
  const started = await startDaemon({
    stateDir: args.stateDir,
    ...(args.protocolVersion !== undefined ? { protocolVersion: args.protocolVersion } : {}),
    ...(args.lockPath !== undefined ? { lockPath: args.lockPath } : {}),
  });
  const shutdown = async (): Promise<void> => {
    await started.close();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

if (isEntrypoint(import.meta.url, process.argv[1])) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`daemon: ${message}\n`);
    process.exit(1);
  });
}
