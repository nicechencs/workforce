import { describe, expect, it } from "vitest";

import { buildCodexExecArgv } from "./command.js";

describe("buildCodexExecArgv", () => {
  it("places global approval, sandbox, and cwd flags before exec", () => {
    expect(
      buildCodexExecArgv({
        executable: "/opt/codex",
        cwd: "/managed/run",
        sandbox: "read-only",
        approval: "never",
      }),
    ).toEqual([
      "/opt/codex",
      "-a",
      "never",
      "-s",
      "read-only",
      "-C",
      "/managed/run",
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--color",
      "never",
      "--json",
      "-",
    ]);
  });

  it("never puts a prompt or a bypass flag in argv", () => {
    const argv = buildCodexExecArgv({
      executable: "codex",
      cwd: "/managed/run",
      sandbox: "workspace-write",
      approval: "on-request",
    });
    expect(argv.at(-1)).toBe("-");
    expect(argv).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });
});
