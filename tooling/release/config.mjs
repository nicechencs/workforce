import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(here, "../..");
export const desktopRoot = path.join(repoRoot, "apps", "desktop");
export const daemonRoot = path.join(repoRoot, "apps", "daemon");
export const defaultOutDir = path.join(repoRoot, "out", "pack");

export const productName = "Workforce";
export const appId = "com.workforce.desktop";
export const upgradeActiveRunPolicy = "reject";

export const electronPlatforms = ["win32", "darwin", "linux"];

export const bundledDaemonResourceDir = "daemon";
export const bundledDaemonEntry = path.join("daemon", "dist", "index.js");
export const packagingMarkerName = "packaging.json";

export const retainUserData = {
  win32: ["%APPDATA%\\Workforce"],
  darwin: ["~/Library/Application Support/Workforce"],
  linux: ["${XDG_CONFIG_HOME:-$HOME/.config}/workforce"],
};

export const skipStateNames = {
  dirs: ["backups", "Cache", "Code Cache", "GPUCache", "CachedData"],
  files: ["daemon.lock.sock"],
};

export function readDesktopPackage() {
  return JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"));
}

export function electronVersionFromDesktop() {
  const pkg = readDesktopPackage();
  const version = pkg.devDependencies?.electron ?? pkg.dependencies?.electron;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("apps/desktop/package.json is missing electron");
  }
  return version.replace(/^[^\d]*/, "");
}

export function electronZipName(version, platform, arch) {
  return `electron-v${version}-${platform}-${arch}.zip`;
}

export function electronDownloadUrl(version, platform, arch) {
  const file = electronZipName(version, platform, arch);
  return `https://github.com/electron/electron/releases/download/v${version}/${file}`;
}

export function executableName(platform) {
  if (platform === "win32") {
    return "Workforce.exe";
  }
  if (platform === "darwin") {
    return "Workforce";
  }
  return "workforce";
}

export function parsePlatformList(raw, hostPlatform = process.platform) {
  if (!raw || raw === "current") {
    return [hostPlatform];
  }
  const items = String(raw)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item === "current" ? hostPlatform : item));
  const unknown = items.filter((item) => !electronPlatforms.includes(item));
  if (unknown.length > 0) {
    throw new Error(`unsupported platform: ${unknown.join(", ")}`);
  }
  return [...new Set(items)];
}

export function parseArchList(raw, platform) {
  if (!raw || raw === "current") {
    if (platform === "darwin") {
      return [process.arch === "arm64" ? "arm64" : "x64"];
    }
    return ["x64"];
  }
  const items = String(raw)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const allowed = new Set(["x64", "arm64"]);
  const unknown = items.filter((item) => !allowed.has(item));
  if (unknown.length > 0) {
    throw new Error(`unsupported arch: ${unknown.join(", ")}`);
  }
  return [...new Set(items)];
}
