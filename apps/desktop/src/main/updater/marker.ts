import fs from "node:fs";

import { packagingMarkerPath } from "./paths.js";

export type SigningStatus = "skipped" | "attempted" | "failed";

export interface PackagingMarker {
  product: string;
  version: string;
  platform: string;
  arch: string;
  electron: string;
  bundledDaemon: true;
  upgradeActiveRunPolicy: "reject";
  signed: boolean;
  published: false;
  installer: string;
  signing: SigningStatus;
  gitSha?: string;
  packedAt?: string;
}

export function readPackagingMarker(resourcesPath: string): PackagingMarker | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(packagingMarkerPath(resourcesPath), "utf8"),
    ) as Partial<PackagingMarker>;
    if (
      raw.bundledDaemon !== true ||
      raw.published !== false ||
      raw.upgradeActiveRunPolicy !== "reject"
    ) {
      return null;
    }
    if (
      typeof raw.product !== "string" ||
      typeof raw.version !== "string" ||
      typeof raw.platform !== "string" ||
      typeof raw.arch !== "string" ||
      typeof raw.electron !== "string" ||
      typeof raw.installer !== "string"
    ) {
      return null;
    }
    const signing: SigningStatus =
      raw.signing === "attempted" || raw.signing === "failed" || raw.signing === "skipped"
        ? raw.signing
        : "skipped";
    const marker: PackagingMarker = {
      product: raw.product,
      version: raw.version,
      platform: raw.platform,
      arch: raw.arch,
      electron: raw.electron,
      bundledDaemon: true,
      upgradeActiveRunPolicy: "reject",
      signed: raw.signed === true,
      published: false,
      installer: raw.installer,
      signing,
    };
    if (typeof raw.gitSha === "string") {
      marker.gitSha = raw.gitSha;
    }
    if (typeof raw.packedAt === "string") {
      marker.packedAt = raw.packedAt;
    }
    return marker;
  } catch {
    return null;
  }
}
