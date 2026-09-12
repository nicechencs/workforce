import fs from "node:fs";
import path from "node:path";

import { retainUserData } from "./config.mjs";
import { ensureDir } from "./lib.mjs";

function windowsUninstallPs1(productName) {
  return `# Uninstall ${productName}. Does not delete %APPDATA%\\Workforce.
$ErrorActionPreference = "Stop"
$installRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$shortcut = Join-Path $env:APPDATA "Microsoft\\Windows\\Start Menu\\Programs\\${productName}.lnk"
if (Test-Path $shortcut) { Remove-Item -Force $shortcut }
Write-Host "Kept user data at $env:APPDATA\\Workforce"
Write-Host "Delete the application folder after closing ${productName}:"
Write-Host $installRoot
`;
}

function linuxUninstallSh(productName) {
  return `#!/bin/sh
# Removes this unpacked application directory. Does not delete
# \${XDG_CONFIG_HOME:-$HOME/.config}/workforce
set -eu
install_root="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
echo "Retaining user data under \${XDG_CONFIG_HOME:-$HOME/.config}/workforce"
echo "Delete $install_root after you close ${productName}."
`;
}

function darwinUninstallTxt(productName) {
  return `${productName} uninstall
Drag the .app to Trash. Do not delete ~/Library/Application Support/Workforce.
User data, SQLite, artifacts and backups stay until you remove that folder yourself.
`;
}

export function writeUninstallHelpers(input) {
  const { unpackedDir, platform, productName: name, version } = input;
  const retained = retainUserData[platform] ?? [];
  const note = [
    `${name} ${version ?? ""}`.trim(),
    `${name} does not delete user data on uninstall.`,
    `Retained paths: ${retained.join(", ")}`,
    "start.cmd / pnpm dev are not installers.",
  ].join("\n");
  fs.writeFileSync(path.join(unpackedDir, "UNINSTALL.txt"), `${note}\n`, "utf8");
  if (platform === "win32") {
    fs.writeFileSync(path.join(unpackedDir, "Uninstall.ps1"), windowsUninstallPs1(name), "utf8");
    return;
  }
  if (platform === "linux") {
    const file = path.join(unpackedDir, "uninstall.sh");
    fs.writeFileSync(file, linuxUninstallSh(name), "utf8");
    fs.chmodSync(file, 0o755);
    return;
  }
  const app = path.join(unpackedDir, `${name}.app`);
  if (fs.existsSync(app)) {
    const resources = path.join(app, "Contents", "Resources");
    ensureDir(resources);
    fs.writeFileSync(path.join(resources, "UNINSTALL.txt"), darwinUninstallTxt(name), "utf8");
  }
}
