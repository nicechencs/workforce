import fs from "node:fs";
import path from "node:path";

import { productName } from "./config.mjs";
import { run, which, writeLine } from "./lib.mjs";

const CREDENTIAL_NAMES = {
  win32: ["WINDOWS_PFX_FILE", "CSC_LINK", "WINDOWS_CERTIFICATE_FILE"],
  darwin: ["APPLE_IDENTITY", "CSC_NAME", "APPLE_API_KEY"],
  linux: [],
};

function envPresent(names) {
  return names.filter((name) => {
    const value = process.env[name];
    return typeof value === "string" && value.length > 0;
  });
}

/**
 * Signing is a hook only. Missing credentials skip signing.
 * Presence of env *names* is reported; values are never logged.
 */
export function resolveSigningPlan(input) {
  const names = CREDENTIAL_NAMES[input.platform] ?? [];
  const present = envPresent(names);
  if (input.skipSign || names.length === 0 || present.length === 0) {
    return {
      status: "skipped",
      reason:
        names.length === 0
          ? "platform_has_no_signing_hook"
          : input.skipSign
            ? "skip_sign"
            : "credentials_unavailable",
      credentialNamesPresent: present,
    };
  }
  return {
    status: "attempted",
    reason: "credentials_available",
    credentialNamesPresent: present,
  };
}

export async function trySignUnpacked(input) {
  const { platform, unpackedDir, plan } = input;
  if (plan.status !== "attempted") {
    return { status: "skipped" };
  }
  try {
    if (platform === "win32") {
      const signtool = which("signtool");
      const pfx = process.env.WINDOWS_PFX_FILE ?? process.env.WINDOWS_CERTIFICATE_FILE;
      if (!signtool || !pfx) {
        writeLine(process.stderr, "signing skipped: signtool or PFX path missing at runtime");
        return { status: "skipped" };
      }
      const exe = path.join(unpackedDir, `${productName}.exe`);
      if (!fs.existsSync(exe)) {
        return { status: "failed" };
      }
      const args = ["sign", "/fd", "SHA256", "/f", pfx];
      if (process.env.WINDOWS_PFX_PASSWORD) {
        args.push("/p", process.env.WINDOWS_PFX_PASSWORD);
      }
      args.push(exe);
      await run(signtool, args);
      return { status: "attempted" };
    }
    if (platform === "darwin") {
      const codesign = which("codesign");
      const identity = process.env.APPLE_IDENTITY ?? process.env.CSC_NAME;
      const app = path.join(unpackedDir, `${productName}.app`);
      if (!codesign || !identity || !fs.existsSync(app)) {
        writeLine(process.stderr, "signing skipped: codesign or identity missing at runtime");
        return { status: "skipped" };
      }
      await run(codesign, ["--force", "--sign", identity, "--deep", "--timestamp", app]);
      return { status: "attempted" };
    }
    return { status: "skipped" };
  } catch (error) {
    writeLine(
      process.stderr,
      `signing failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return { status: "failed" };
  }
}
