import fs from "node:fs";
import path from "node:path";

export interface CodexDetection {
  found: boolean;
  executable?: string;
  version?: string;
  source: "configured" | "path" | "localappdata" | "windowsapps" | "none";
}

export interface DetectCodexOptions {
  configuredExecutable?: string;
  pathDirs?: string[];
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: string;
  existsSync?: (file: string) => boolean;
  readVersion?: (executable: string) => string | undefined;
}

const VERSION_RE = /^codex-cli\s+(\S+)/m;

export function parseCodexVersion(output: string): string | undefined {
  const match = VERSION_RE.exec(output);
  return match?.[1];
}

function isExecutable(file: string, existsSync: (file: string) => boolean): boolean {
  return existsSync(file);
}

function foundDetection(
  source: Exclude<CodexDetection["source"], "none">,
  executable: string,
  version: string | undefined,
): CodexDetection {
  return version
    ? { found: true, executable, version, source }
    : { found: true, executable, source };
}

function pathCandidates(pathDirs: string[], platform: NodeJS.Platform): string[] {
  const names = platform === "win32" ? ["codex.exe", "codex.cmd", "codex"] : ["codex"];
  const out: string[] = [];
  for (const dir of pathDirs) {
    for (const name of names) {
      out.push(path.join(dir, name));
    }
  }
  return out;
}

function windowsExtraCandidates(
  env: NodeJS.ProcessEnv,
  existsSync: (file: string) => boolean,
): {
  localAppData: string[];
  windowsApps: string[];
} {
  const localAppData = env.LOCALAPPDATA ?? path.join(env.USERPROFILE ?? "", "AppData", "Local");
  const hashed = path.join(localAppData, "OpenAI", "Codex", "bin");
  const localAppDataHits: string[] = [];
  if (existsSync(hashed)) {
    try {
      for (const entry of fs.readdirSync(hashed, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        localAppDataHits.push(path.join(hashed, entry.name, "codex.exe"));
      }
    } catch {
      // Detection is best-effort; Host validate reports missing binary.
    }
  }

  const programFiles = env.ProgramFiles ?? "C:\\Program Files";
  const apps = path.join(programFiles, "WindowsApps");
  const windowsApps: string[] = [];
  if (existsSync(apps)) {
    try {
      for (const entry of fs.readdirSync(apps, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith("OpenAI.Codex_")) {
          continue;
        }
        windowsApps.push(path.join(apps, entry.name, "app", "resources", "codex.exe"));
      }
    } catch {
      // ignore
    }
  }
  return { localAppData: localAppDataHits, windowsApps };
}

export function detectCodex(options: DetectCodexOptions = {}): CodexDetection {
  const existsSync = options.existsSync ?? fs.existsSync;
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const pathDirs = options.pathDirs ?? (env.PATH ?? env.Path ?? "").split(path.delimiter);

  if (options.configuredExecutable && isExecutable(options.configuredExecutable, existsSync)) {
    return foundDetection(
      "configured",
      options.configuredExecutable,
      options.readVersion?.(options.configuredExecutable),
    );
  }

  for (const candidate of pathCandidates(pathDirs, platform)) {
    if (isExecutable(candidate, existsSync)) {
      return foundDetection("path", candidate, options.readVersion?.(candidate));
    }
  }

  if (platform === "win32") {
    const extra = windowsExtraCandidates(env, existsSync);
    for (const candidate of extra.localAppData) {
      if (isExecutable(candidate, existsSync)) {
        return foundDetection("localappdata", candidate, options.readVersion?.(candidate));
      }
    }
    for (const candidate of extra.windowsApps) {
      if (isExecutable(candidate, existsSync)) {
        return foundDetection("windowsapps", candidate, options.readVersion?.(candidate));
      }
    }
  }

  return { found: false, source: "none" };
}
