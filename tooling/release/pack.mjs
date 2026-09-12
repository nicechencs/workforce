#!/usr/bin/env node
/**
 * Pack Workforce Desktop + bundled Daemon for win32 / darwin / linux.
 * Does not publish, does not create a GitHub Release, and does not treat
 * start.cmd or `pnpm dev` as installers. Signing runs only when credentials exist.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { assembleTarget } from "./assemble.mjs";
import {
  defaultOutDir,
  electronVersionFromDesktop,
  parseArchList,
  parsePlatformList,
  productName,
  readDesktopPackage,
  upgradeActiveRunPolicy,
} from "./config.mjs";
import { fail, writeJson, writeLine } from "./lib.mjs";
import { stageAppAndDaemon } from "./stage.mjs";

function help() {
  return `Usage:
  node tooling/release/pack.mjs [--platform current|linux,win32,darwin]
                                 [--arch current|x64,arm64]
                                 [--out DIR]
                                 [--skip-build]
                                 [--skip-sign]

Produces unpacked trees under out/pack/unpacked and archives under out/pack/artifacts.
Does not publish. Signing is skipped unless platform credentials are present.
Active-run upgrade policy is frozen to ${upgradeActiveRunPolicy}.
`;
}

function parseArgs(argv) {
  const out = {
    platform: "current",
    arch: "current",
    out: defaultOutDir,
    skipBuild: false,
    skipSign: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--platform" && next) {
      out.platform = next;
      i += 1;
    } else if (arg === "--arch" && next) {
      out.arch = next;
      i += 1;
    } else if (arg === "--out" && next) {
      out.out = path.resolve(next);
      i += 1;
    } else if (arg === "--skip-build") {
      out.skipBuild = true;
    } else if (arg === "--skip-sign") {
      out.skipSign = true;
    } else {
      fail(`unknown argument: ${arg}\n${help()}`);
    }
  }
  return out;
}

export async function pack(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    writeLine(process.stdout, help());
    return { ok: true, skipped: true };
  }
  const version = readDesktopPackage().version ?? "0.0.0";
  const platforms = parsePlatformList(args.platform);
  const stageRoot = path.join(args.out, "stage");
  writeLine(
    process.stdout,
    `packing ${productName} ${version} electron ${electronVersionFromDesktop()} policy=${upgradeActiveRunPolicy}`,
  );
  const staged = await stageAppAndDaemon({
    version,
    stageRoot,
    skipBuild: args.skipBuild,
  });
  const results = [];
  for (const platform of platforms) {
    const arches = parseArchList(args.arch, platform);
    for (const arch of arches) {
      writeLine(process.stdout, `assemble ${platform}-${arch}`);
      results.push(
        await assembleTarget({
          platform,
          arch,
          stageApp: staged.stageApp,
          daemonDir: staged.daemonDir,
          outDir: args.out,
          version,
          skipSign: args.skipSign,
        }),
      );
    }
  }
  const summary = {
    product: productName,
    version,
    published: false,
    upgradeActiveRunPolicy,
    startCmdIsInstaller: false,
    results: results.map((item) => ({
      platform: item.platform,
      arch: item.arch,
      archivePath: item.archivePath,
      unpackedDir: item.unpackedDir,
      signed: item.marker.signed,
      signing: item.marker.signing,
      published: false,
    })),
  };
  writeJson(path.join(args.out, "summary.json"), summary);
  writeLine(process.stdout, `wrote ${path.join(args.out, "summary.json")}`);
  for (const item of summary.results) {
    writeLine(process.stdout, `${item.platform}-${item.arch} ${item.signing} ${item.archivePath}`);
  }
  return summary;
}

const invoked =
  Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invoked) {
  pack().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}
