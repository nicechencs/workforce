import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

import {
  bodyMatchesFingerprint,
  classifyProcess,
  collectAncestors,
  isDirectRun,
  main,
  rendererFingerprint,
  selectProcessesToStop,
} from "./stop-desktop.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(root, "tooling/scripts/stop-desktop.mjs");

function run(args: string[]): string {
  return execFileSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
}

describe("stop-desktop markers", () => {
  it("recognizes the repository's own dev processes", () => {
    expect(
      classifyProcess(
        "electron.exe D:\\demo\\chen\\2026\\workforce\\apps\\desktop\\dist\\main\\electron-main.js",
      ),
    ).toBe("desktop-ui");
    expect(
      classifyProcess("electron.exe --import ... D:\\shop\\workforce\\apps\\daemon\\src\\index.ts"),
    ).toBe("daemon");
    expect(classifyProcess("node tooling\\scripts\\start-desktop.mjs")).toBe("launcher");
    expect(
      classifyProcess(
        "C:\\Windows\\system32\\cmd.exe /d /s /c pnpm --filter @workforce/desktop dev",
      ),
    ).toBe("dev-run");
  });

  it("ignores a different repository's Vite dev server", () => {
    expect(
      classifyProcess('node "D:\\demo\\chen\\2026\\AgentHub\\node_modules\\bin\\vite.js"'),
    ).toBeNull();
    expect(classifyProcess("node ./scripts/dev.mjs")).toBeNull();
    expect(classifyProcess("")).toBeNull();
    expect(classifyProcess(undefined)).toBeNull();
  });

  it("does not treat a loose @workforce/desktop mention as the dev run", () => {
    expect(classifyProcess("node build.mjs --target @workforce/desktop dev")).toBeNull();
  });
});

describe("stop-desktop selection", () => {
  const processes = [
    { pid: 10, parentPid: 1, commandLine: "node tooling\\scripts\\start-desktop.mjs" },
    { pid: 11, parentPid: 10, commandLine: "cmd.exe /c pnpm --filter @workforce/desktop dev" },
    { pid: 12, parentPid: 11, commandLine: "node ./scripts/dev.mjs" },
    { pid: 20, parentPid: 1, commandLine: "node D:\\demo\\chen\\2026\\AgentHub\\vite.js" },
    {
      pid: 30,
      parentPid: 1,
      commandLine: "electron.exe ...\\workforce\\apps\\daemon\\src\\index.ts",
    },
  ];

  it("selects launcher, dev run and daemon, and never the other repository", () => {
    const targets = selectProcessesToStop({
      processes,
      excludePids: new Set([99]),
      daemonPid: 30,
    });
    expect(targets.map((target) => target.pid)).toEqual([10, 11, 30]);
    expect(targets.map((target) => target.reason)).toEqual(["launcher", "dev-run", "daemon"]);
  });

  it("adds a dev server confirmed by the HTTP probe even without a path in its command line", () => {
    const targets = selectProcessesToStop({
      processes,
      excludePids: new Set([99]),
      daemonPid: null,
      portOwners: [12],
    });
    expect(targets.map((target) => target.pid)).toContain(12);
    expect(targets.find((target) => target.pid === 12)?.reason).toBe("dev-server");
  });

  it("honours --keep-daemon even though the daemon command line matches the daemon marker", () => {
    const targets = selectProcessesToStop({
      processes,
      excludePids: new Set([99]),
      daemonPid: null,
      skipReasons: new Set(["daemon"]),
    });
    expect(targets.map((target) => target.pid)).not.toContain(30);
    expect(targets.map((target) => target.pid)).toEqual([10, 11]);
  });

  it("excludes the calling shell so restart.cmd cannot kill its own parent", () => {
    const own = [
      { pid: 40, parentPid: 1, commandLine: "cmd.exe /c restart.cmd" },
      { pid: 41, parentPid: 40, commandLine: "node tooling/scripts/stop-desktop.mjs" },
      { pid: 10, parentPid: 1, commandLine: "node tooling\\scripts\\start-desktop.mjs" },
    ];
    const excludePids = collectAncestors(own, 41);
    expect([...excludePids].sort((a, b) => a - b)).toEqual([40, 41]);
    const targets = selectProcessesToStop({ processes: own, excludePids, daemonPid: null });
    expect(targets.map((target) => target.pid)).toEqual([10]);
  });
});

describe("stop-desktop dev server fingerprint", () => {
  it("reads the title and entry script from the renderer index.html", () => {
    const fingerprint = rendererFingerprint(
      '<html><head><title>Workforce</title></head><body><script type="module" src="/src/renderer/main.tsx"></script></body></html>',
    );
    expect(fingerprint).toEqual({ title: "Workforce", entry: "/src/renderer/main.tsx" });
  });

  it("rejects another application's index.html even though Vite answers 200 for any path", () => {
    const ours = rendererFingerprint(
      '<title>Workforce</title><script src="/src/renderer/main.tsx"></script>',
    );
    expect(bodyMatchesFingerprint("<title>AgentHub</title>", ours)).toBe(false);
    expect(
      bodyMatchesFingerprint('<title>Workforce</title><script src="/src/renderer/main.tsx">', ours),
    ).toBe(true);
  });
});

describe("stop-desktop entry point guard", () => {
  it("only runs when executed directly, so importing it cannot kill processes", async () => {
    expect(isDirectRun(script, pathToFileURL(script).href)).toBe(true);
    expect(
      isDirectRun(path.join(root, "tooling/scripts/other.mjs"), pathToFileURL(script).href),
    ).toBe(false);
    expect(isDirectRun(undefined, pathToFileURL(script).href)).toBe(false);
    // 导入本模块（本文件顶部已这样做）后应完全无副作用；再显式跑一次 --help。
    const written = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    try {
      expect(await main(["--help"])).toBe(0);
      expect(written).toHaveBeenCalled();
    } finally {
      written.mockRestore();
    }
  });
});

describe("stop-desktop CLI", () => {
  it("prints help without killing anything", () => {
    const output = run(["--help"]);
    expect(output).toContain("Workforce desktop process cleanup");
    expect(output).toContain("--dry-run");
    expect(output).toContain("--keep-daemon");
  });

  it("dry-run reports a plan and exits zero without killing", () => {
    const output = run(["--dry-run"]);
    expect(output).toMatch(/发现 \d+ 个残留进程|没有发现属于本仓库的残留进程/);
  });
});
