import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  resolveWorkspaceTsEsmHookUrl,
  resolveWorkspaceTsEsmRegisterUrl,
} from "../src/main/ts-esm-loader.js";

describe("workspace TypeScript ESM loader URLs", () => {
  it("points at the shared tooling scripts from the desktop app root", () => {
    const appRoot = path.resolve("apps/desktop");
    expect(resolveWorkspaceTsEsmHookUrl(appRoot)).toContain("tooling/scripts/ts-esm-resolve.mjs");
    expect(resolveWorkspaceTsEsmRegisterUrl(appRoot)).toContain(
      "tooling/scripts/register-ts-esm.mjs",
    );
  });
});
