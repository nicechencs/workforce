import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  bundledDaemonResourceDir,
  electronDownloadUrl,
  electronVersionFromDesktop,
  electronZipName,
  executableName,
  packagingMarkerName,
  productName,
  repoRoot,
} from "./config.mjs";
import { copyDir, ensureDir, rmrf, run, which, writeJson, writeLine } from "./lib.mjs";
import { resolveSigningPlan, trySignUnpacked } from "./sign.mjs";
import { writeUninstallHelpers } from "./uninstall.mjs";
import { localElectronDist } from "./stage.mjs";

async function unzip(zipFile, dest) {
  ensureDir(dest);
  const unzipBin = which("unzip");
  if (unzipBin) {
    await run(unzipBin, ["-q", "-o", zipFile, "-d", dest]);
    return;
  }
  await run("python3", ["-m", "zipfile", "-e", zipFile, dest]);
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(file);
  await new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download failed ${res.status} ${url}`);
  }
  ensureDir(path.dirname(dest));
  const bytes = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, bytes);
  return bytes.length;
}

async function checksumsFor(version, cacheDir) {
  const url = `https://github.com/electron/electron/releases/download/v${version}/SHASUMS256.txt`;
  const file = path.join(cacheDir, `SHASUMS256-${version}.txt`);
  if (!fs.existsSync(file)) {
    await download(url, file);
  }
  const map = new Map();
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match) {
      map.set(match[2], match[1]);
    }
  }
  return map;
}

async function ensureElectronZip(version, platform, arch, cacheDir) {
  const name = electronZipName(version, platform, arch);
  const zipFile = path.join(cacheDir, name);
  if (!fs.existsSync(zipFile)) {
    writeLine(process.stdout, `download ${name}`);
    await download(electronDownloadUrl(version, platform, arch), zipFile);
  }
  const sums = await checksumsFor(version, cacheDir);
  const expected = sums.get(name);
  if (!expected) {
    throw new Error(`SHASUMS256.txt has no entry for ${name}`);
  }
  const actual = await sha256File(zipFile);
  if (actual !== expected) {
    throw new Error(`checksum mismatch for ${name}`);
  }
  return zipFile;
}

function gitSha() {
  try {
    return fs.existsSync(path.join(repoRoot, ".git"))
      ? fs.readFileSync(path.join(repoRoot, ".git", "HEAD"), "utf8").trim()
      : "unknown";
  } catch {
    return "unknown";
  }
}

function resolveGitSha() {
  try {
    const head = fs.readFileSync(path.join(repoRoot, ".git", "HEAD"), "utf8").trim();
    if (head.startsWith("ref:")) {
      const ref = head.slice(4).trim();
      return fs.readFileSync(path.join(repoRoot, ".git", ref), "utf8").trim();
    }
    return head;
  } catch {
    return gitSha();
  }
}

async function extractElectron(version, platform, arch, unpackedDir, cacheDir, hostMatches) {
  rmrf(unpackedDir);
  ensureDir(unpackedDir);
  if (hostMatches) {
    const local = localElectronDist();
    if (local) {
      copyDir(local, unpackedDir);
      return;
    }
  }
  const zipFile = await ensureElectronZip(version, platform, arch, cacheDir);
  await unzip(zipFile, unpackedDir);
}

function overlayApp(unpackedDir, stageApp, daemonDir, platform) {
  const resources =
    platform === "darwin"
      ? path.join(unpackedDir, "Electron.app", "Contents", "Resources")
      : path.join(unpackedDir, "resources");
  if (!fs.existsSync(resources)) {
    throw new Error(`electron resources missing under ${unpackedDir}`);
  }
  const appDir = path.join(resources, "app");
  rmrf(appDir);
  copyDir(stageApp, appDir);
  copyDir(daemonDir, path.join(resources, bundledDaemonResourceDir));
  const electronRoot =
    platform === "darwin" ? path.join(unpackedDir, "Electron.app", "Contents") : unpackedDir;
  const tooling = path.join(stageApp, "..", "tooling", "scripts");
  if (fs.existsSync(tooling)) {
    copyDir(path.join(stageApp, "..", "tooling"), path.join(electronRoot, "tooling"));
  }
  return { resources, appDir, electronRoot };
}

function renameBinary(unpackedDir, platform) {
  const name = executableName(platform);
  if (platform === "win32") {
    const from = path.join(unpackedDir, "electron.exe");
    const to = path.join(unpackedDir, name);
    if (fs.existsSync(from)) {
      fs.renameSync(from, to);
    }
    return;
  }
  if (platform === "linux") {
    const from = path.join(unpackedDir, "electron");
    const to = path.join(unpackedDir, name);
    if (fs.existsSync(from)) {
      fs.renameSync(from, to);
    }
    return;
  }
  const fromApp = path.join(unpackedDir, "Electron.app");
  const toApp = path.join(unpackedDir, `${productName}.app`);
  if (fs.existsSync(fromApp) && !fs.existsSync(toApp)) {
    fs.renameSync(fromApp, toApp);
  }
  const plist = path.join(toApp, "Contents", "Info.plist");
  if (fs.existsSync(plist)) {
    const body = fs
      .readFileSync(plist, "utf8")
      .replaceAll("<string>Electron</string>", `<string>${productName}</string>`);
    fs.writeFileSync(plist, body, "utf8");
  }
}

async function archive(unpackedDir, artifactsDir, platform, arch) {
  ensureDir(artifactsDir);
  const base = `workforce-${platform}-${arch}`;
  if (platform === "linux") {
    const tar = path.join(artifactsDir, `${base}.tar.gz`);
    await run("tar", ["-C", path.dirname(unpackedDir), "-czf", tar, path.basename(unpackedDir)]);
    return tar;
  }
  const zipBin = which("zip");
  const zipFile = path.join(artifactsDir, `${base}.zip`);
  if (zipBin) {
    await run(zipBin, ["-qry", zipFile, path.basename(unpackedDir)], {
      cwd: path.dirname(unpackedDir),
    });
    return zipFile;
  }
  const tar = path.join(artifactsDir, `${base}.tar.gz`);
  await run("tar", ["-C", path.dirname(unpackedDir), "-czf", tar, path.basename(unpackedDir)]);
  return tar;
}

export async function assembleTarget(options) {
  const { platform, arch, stageApp, daemonDir, outDir, version, skipSign } = options;
  const electronVersion = electronVersionFromDesktop();
  const cacheDir = path.join(outDir, "cache");
  const unpackedDir = path.join(outDir, "unpacked", `${platform}-${arch}`);
  const artifactsDir = path.join(outDir, "artifacts");
  const hostMatches =
    platform === process.platform && arch === (process.arch === "arm64" ? "arm64" : process.arch);
  await extractElectron(electronVersion, platform, arch, unpackedDir, cacheDir, hostMatches);
  const overlay = overlayApp(unpackedDir, stageApp, daemonDir, platform);
  renameBinary(unpackedDir, platform);
  const resources =
    platform === "darwin"
      ? path.join(unpackedDir, `${productName}.app`, "Contents", "Resources")
      : overlay.resources;
  const signingPlan = resolveSigningPlan({ platform, skipSign: skipSign === true });
  let signing = signingPlan.status;
  if (signingPlan.status === "attempted") {
    const result = await trySignUnpacked({
      platform,
      unpackedDir,
      plan: signingPlan,
    });
    signing = result.status;
  }
  const marker = {
    product: productName,
    version,
    platform,
    arch,
    electron: electronVersion,
    bundledDaemon: true,
    upgradeActiveRunPolicy: "reject",
    signed: signing === "attempted",
    published: false,
    installer: platform === "linux" ? "unpacked-tar.gz" : "unpacked-zip",
    signing,
    gitSha: resolveGitSha(),
    packedAt: new Date().toISOString(),
    note: "start.cmd and pnpm dev are not installers. This artifact is not a published release.",
  };
  writeJson(path.join(resources, packagingMarkerName), marker);
  writeUninstallHelpers({ unpackedDir, platform, productName, version });
  const archivePath = await archive(unpackedDir, artifactsDir, platform, arch);
  return {
    platform,
    arch,
    unpackedDir,
    archivePath,
    marker,
    signingPlan,
  };
}
