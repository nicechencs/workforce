import path from "node:path";

export const DESKTOP_SMOKE_ENV = {
  enabled: "WORKFORCE_DESKTOP_SMOKE",
  headed: "WORKFORCE_DESKTOP_SMOKE_HEADED",
  workspace: "WORKFORCE_SMOKE_WORKSPACE",
  result: "WORKFORCE_DESKTOP_SMOKE_OUT",
  headless: "ELECTRON_HEADLESS",
} as const;

export function isDesktopSmokeEnabled(env: Record<string, string | undefined>): boolean {
  return env[DESKTOP_SMOKE_ENV.enabled] === "1";
}

export function isDesktopSmokeHeaded(env: Record<string, string | undefined>): boolean {
  return env[DESKTOP_SMOKE_ENV.headed] === "1";
}

export function shouldLaunchElectronHeadless(env: Record<string, string | undefined>): boolean {
  if (isDesktopSmokeHeaded(env)) {
    return false;
  }
  return isDesktopSmokeEnabled(env) || env[DESKTOP_SMOKE_ENV.headless] === "1";
}

export function resolveSmokeWorkspacePath(env: Record<string, string | undefined>): string | null {
  const value = env[DESKTOP_SMOKE_ENV.workspace];
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return path.resolve(value);
}

/** Directory-dialog override is opt-in only. Normal `dev` / `start` never skip the picker. */
export function resolveSmokeDirectoryOverride(
  env: Record<string, string | undefined>,
): string | null {
  if (!isDesktopSmokeEnabled(env)) {
    return null;
  }
  return resolveSmokeWorkspacePath(env);
}

export function resolveSmokeResultPath(env: Record<string, string | undefined>): string | null {
  const value = env[DESKTOP_SMOKE_ENV.result];
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return path.resolve(value);
}

export function resolveDaemonLaunchArgs(
  entry: string,
  stateDir: string,
  options: { importModule?: string } = {},
): string[] {
  const flags: string[] = [];
  if (options.importModule) {
    flags.push("--import", options.importModule);
  }
  if (entry.endsWith(".ts") || entry.endsWith(".mts") || entry.endsWith(".cts")) {
    // Strip-only mode rejects TypeScript that has to emit code (parameter properties),
    // which the daemon sources use. The dev entry needs a real transformation pass.
    flags.push("--experimental-transform-types");
  }
  return [...flags, entry, "--state-dir", stateDir];
}
