import path from "node:path";
import { pathToFileURL } from "node:url";

function workspaceToolingScript(appRoot: string, filename: string): string {
  return pathToFileURL(path.join(appRoot, "..", "..", "tooling", "scripts", filename)).href;
}

/** Customization hook module that exports `resolve`. Use with `module.register`. */
export function resolveWorkspaceTsEsmHookUrl(appRoot: string): string {
  return workspaceToolingScript(appRoot, "ts-esm-resolve.mjs");
}

/** Side-effect entry that calls `register`. Use with Node `--import`. */
export function resolveWorkspaceTsEsmRegisterUrl(appRoot: string): string {
  return workspaceToolingScript(appRoot, "register-ts-esm.mjs");
}
