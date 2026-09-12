import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  bundledDaemonResourceDir,
  daemonRoot,
  desktopRoot,
  productName,
  repoRoot,
} from "./config.mjs";
import { copyDir, ensureDir, rmrf, run, writeJson, writeLine } from "./lib.mjs";

function stagedPackageJson(version, extra = {}) {
  return {
    name: "workforce",
    productName,
    version,
    private: true,
    type: "module",
    main: "./dist/main/electron-main.js",
    ...extra,
  };
}

function writePackagedElectronMain(stageApp) {
  const mainFile = path.join(stageApp, "dist", "main", "electron-main.js");
  if (!fs.existsSync(path.join(stageApp, "dist", "main", "electron-runtime.js"))) {
    throw new Error("desktop dist/main/electron-runtime.js is missing");
  }
  fs.writeFileSync(mainFile, 'import "./electron-runtime.js";\n', "utf8");
}

function copyDesktopFallback(stageApp) {
  const dist = path.join(desktopRoot, "dist");
  if (!fs.existsSync(dist)) {
    throw new Error("apps/desktop/dist is missing; build the desktop app first");
  }
  copyDir(dist, path.join(stageApp, "dist"));
  const modules = path.join(desktopRoot, "node_modules");
  if (fs.existsSync(modules)) {
    copyDir(modules, path.join(stageApp, "node_modules"), { dereference: true });
  }
}

async function deployOrCopy(filter, dest, fallback) {
  rmrf(dest);
  ensureDir(path.dirname(dest));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-deploy-"));
  try {
    // pnpm deploy into a workspace path named `out/...` tries mkdir('/out').
    await run("pnpm", ["--filter", filter, "deploy", "--prod", tmp], { cwd: repoRoot });
    copyDir(tmp, dest);
  } catch (error) {
    writeLine(
      process.stderr,
      `pnpm deploy ${filter} failed (${error instanceof Error ? error.message : error}); using copy fallback`,
    );
    rmrf(dest);
    ensureDir(dest);
    fallback();
  } finally {
    rmrf(tmp);
  }
}

async function stageDesktop(stageApp, version) {
  await deployOrCopy("@workforce/desktop", stageApp, () => copyDesktopFallback(stageApp));
  const pkgPath = path.join(stageApp, "package.json");
  const deployed = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, "utf8")) : {};
  writeJson(pkgPath, stagedPackageJson(version, { dependencies: deployed.dependencies }));
  writePackagedElectronMain(stageApp);
  for (const required of ["dist/preload/electron-entry.cjs", "dist/renderer/index.html"]) {
    if (!fs.existsSync(path.join(stageApp, required))) {
      throw new Error(`packaged desktop missing ${required}`);
    }
  }
}

async function stageDaemon(stageRoot) {
  const dest = path.join(stageRoot, bundledDaemonResourceDir);
  await deployOrCopy("@workforce/daemon", dest, () => {
    const dist = path.join(daemonRoot, "dist");
    if (!fs.existsSync(dist)) {
      throw new Error("apps/daemon/dist is missing; build the daemon first");
    }
    copyDir(dist, path.join(dest, "dist"));
    fs.copyFileSync(path.join(daemonRoot, "package.json"), path.join(dest, "package.json"));
    const modules = path.join(daemonRoot, "node_modules");
    if (fs.existsSync(modules)) {
      copyDir(modules, path.join(dest, "node_modules"), { dereference: true });
    }
  });
  const pkgPath = path.join(dest, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    pkg.main = "./dist/index.js";
    writeJson(pkgPath, pkg);
  }
  const entry = path.join(dest, "dist", "index.js");
  if (!fs.existsSync(entry)) {
    throw new Error(`bundled daemon entry missing: ${entry}`);
  }
}

function copyTsEsmHooks(stageRoot) {
  const from = path.join(repoRoot, "tooling", "scripts");
  const to = path.join(stageRoot, "tooling", "scripts");
  ensureDir(to);
  for (const name of ["register-ts-esm.mjs", "ts-esm-resolve.mjs"]) {
    fs.copyFileSync(path.join(from, name), path.join(to, name));
  }
}

export function localElectronDist() {
  const require = createRequire(path.join(desktopRoot, "package.json"));
  try {
    const pkg = path.dirname(require.resolve("electron/package.json"));
    const dist = path.join(pkg, "dist");
    return fs.existsSync(dist) ? dist : null;
  } catch {
    return null;
  }
}

export async function stageAppAndDaemon(options) {
  const { version, stageRoot } = options;
  const stageApp = path.join(stageRoot, "app");
  rmrf(stageRoot);
  ensureDir(stageRoot);
  if (!options.skipBuild) {
    await run(
      "pnpm",
      ["--filter", "@workforce/desktop...", "--filter", "@workforce/daemon...", "build"],
      { cwd: repoRoot },
    );
  }
  await stageDesktop(stageApp, version);
  await stageDaemon(stageRoot);
  copyTsEsmHooks(stageRoot);
  return { stageRoot, stageApp, daemonDir: path.join(stageRoot, bundledDaemonResourceDir) };
}
