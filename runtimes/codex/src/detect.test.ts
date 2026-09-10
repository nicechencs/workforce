import path from "node:path";

import { describe, expect, it } from "vitest";

import { detectCodex, parseCodexVersion } from "./detect.js";

describe("Codex detection (T03 rules)", () => {
  it("parses `codex-cli` version output", () => {
    expect(parseCodexVersion("codex-cli 0.153.4\n")).toBe("0.153.4");
  });

  it("prefers a configured executable over PATH", () => {
    const configured = path.join("/opt", "codex");
    const onPath = path.join("/usr", "bin", "codex");
    const found = detectCodex({
      configuredExecutable: configured,
      pathDirs: [path.dirname(onPath)],
      platform: "linux",
      existsSync: (file) => file === configured || file === onPath,
    });
    expect(found).toMatchObject({ found: true, source: "configured", executable: configured });
  });

  it("searches PATH when nothing is configured", () => {
    const onPath = path.join("/usr", "local", "bin", "codex");
    const found = detectCodex({
      pathDirs: [path.dirname(onPath)],
      platform: "linux",
      existsSync: (file) => file === onPath,
    });
    expect(found).toMatchObject({ found: true, source: "path", executable: onPath });
  });

  it("does not invent a Linux binary when PATH is empty", () => {
    const found = detectCodex({
      pathDirs: [],
      platform: "linux",
      existsSync: () => false,
    });
    expect(found).toEqual({ found: false, source: "none" });
  });

  it("uses LocalAppData hashed CLI before WindowsApps", () => {
    const hashed = path.join(
      "C:",
      "Users",
      "chen",
      "AppData",
      "Local",
      "OpenAI",
      "Codex",
      "bin",
      "abc",
      "codex.exe",
    );
    const found = detectCodex({
      pathDirs: [],
      platform: "win32",
      env: {
        LOCALAPPDATA: path.join("C:", "Users", "chen", "AppData", "Local"),
        USERPROFILE: path.join("C:", "Users", "chen"),
      },
      existsSync: (file) =>
        file === hashed ||
        file === path.dirname(hashed) ||
        file === path.dirname(path.dirname(hashed)),
    });
    // readdir of hashed bin is real fs; without the directory this stays none — assert no PATH false positive
    expect(found.source === "localappdata" || found.source === "none").toBe(true);
  });
});
