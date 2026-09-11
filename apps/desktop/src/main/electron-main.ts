import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveWorkspaceTsEsmHookUrl } from "./ts-esm-loader.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
register(resolveWorkspaceTsEsmHookUrl(appRoot));

await import("./electron-runtime.js");
