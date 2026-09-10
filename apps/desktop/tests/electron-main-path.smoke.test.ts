import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Headed/headless Electron click path. Default `pnpm test` skips this so CI
 * does not need a display or the Electron + Vite boot. Opt in with:
 *   pnpm --filter @workforce/desktop smoke
 * or:
 *   WORKFORCE_DESKTOP_SMOKE=1 pnpm exec vitest run apps/desktop/tests/electron-main-path.smoke.test.ts
 */
const enabled = process.env.WORKFORCE_DESKTOP_SMOKE === "1";
const script = fileURLToPath(new URL("../scripts/smoke.mjs", import.meta.url));
const desktopRoot = path.resolve(path.dirname(script), "..");

describe.skipIf(!enabled)("electron desktop main path", () => {
  it(
    "launches Electron and clicks create → plan → confirm → start",
    { timeout: 180_000 },
    async () => {
      const exitCode = await new Promise<number>((resolve, reject) => {
        const child = spawn(process.execPath, [script], {
          cwd: desktopRoot,
          stdio: "inherit",
          env: { ...process.env, WORKFORCE_DESKTOP_SMOKE: "1" },
        });
        child.on("error", reject);
        child.on("exit", (code) => {
          resolve(code ?? 1);
        });
      });
      expect(exitCode).toBe(0);
    },
  );
});
