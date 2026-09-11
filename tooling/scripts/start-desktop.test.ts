import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(root, "tooling/scripts/start-desktop.mjs");

function run(args: string[]): string {
  return execFileSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

describe("start-desktop launcher", () => {
  it("prints help without launching Electron", () => {
    const output = run(["--help"]);
    expect(output).toContain("Workforce local desktop launcher");
    expect(output).toContain("--dry-run");
  });

  it("dry-run reports node, pnpm, and the desktop dev command", () => {
    const output = run(["--dry-run"]);
    expect(output).toContain("Workforce Desktop (dev)");
    expect(output).toContain(root);
    expect(output).toContain("pnpm --filter @workforce/desktop dev");
  });
});
