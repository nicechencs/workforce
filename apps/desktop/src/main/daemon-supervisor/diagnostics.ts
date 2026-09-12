import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  DaemonExitObservation,
  DaemonStateFile,
  InspectStatus,
  SpawnedDaemon,
} from "./types.js";

export const DESKTOP_DIAGNOSTIC_KIND = "desktop.daemon-supervisor" as const;

const STDERR_CAP_BYTES = 8 * 1024;
const SENSITIVE_ENV_KEY =
  /(?:password|passwd|secret|token|api[_-]?key|authorization|private[_-]?key|credential|session)/i;
const ENV_ASSIGNMENT_LINE = /^[A-Za-z_][A-Za-z0-9_]*=/;
const TOKEN_PATTERNS: readonly RegExp[] = [
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{36}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._\-+=/]+\b/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /"(?:bootstrapToken|sessionToken|access_token|refresh_token|client_secret)"\s*:\s*"[^"]*"/g,
];
const WINDOWS_USER_PATH = /\b[A-Za-z]:\\Users\\[^\\/\s"']+/g;
const UNIX_HOME_PATH = /\/(?:home|Users)\/[^/\s"']+/g;

export type DaemonDiagnosticCode =
  | "preflight"
  | "port_conflict"
  | "crash"
  | "spawn_error"
  | "state_not_replaced"
  | "health_failed"
  | "identity_mismatch"
  | "unhealthy_live"
  | "offline";

export interface DaemonSidecarPresence {
  daemonState: boolean;
  world: boolean;
  bootstrap: boolean;
}

export interface DaemonStateSummary {
  pid: number;
  port: number;
  protocolVersion: string;
  startedAt: string;
  startIdentityPresent: boolean;
}

export interface DesktopDaemonDiagnostic {
  kind: typeof DESKTOP_DIAGNOSTIC_KIND;
  generatedAt: string;
  code: DaemonDiagnosticCode;
  message: string;
  inspectStatus?: InspectStatus;
  exit: DaemonExitObservation | null;
  state: DaemonStateSummary | null;
  sidecar: DaemonSidecarPresence;
  stderrExcerpt: string;
  redaction: { applied: boolean; categories: string[] };
}

export interface ClassifyLaunchFailureInput {
  now(): Date;
  stateDir: string;
  inspectStatus: InspectStatus;
  previousState: DaemonStateFile | null;
  publishedState: DaemonStateFile | null;
  child: SpawnedDaemon | null;
  stderr: string;
  spawnErrorMessage: string | null;
  lockHeld: boolean;
  portBusy: boolean;
  spawnAttempted: boolean;
  preflightMessage?: string | null;
  healthFailed?: boolean;
}

export function daemonDiagnosticsDir(stateDir: string): string {
  return path.join(stateDir, "diagnostics");
}

export function daemonStderrLogPath(stateDir: string): string {
  return path.join(daemonDiagnosticsDir(stateDir), "daemon-stderr.log");
}

export function daemonDiagnosticSnapshotPath(stateDir: string): string {
  return path.join(daemonDiagnosticsDir(stateDir), "latest.json");
}

export function summarizeDaemonState(state: DaemonStateFile | null): DaemonStateSummary | null {
  if (!state) {
    return null;
  }
  return {
    pid: state.pid,
    port: state.port,
    protocolVersion: state.protocolVersion,
    startedAt: state.startedAt,
    startIdentityPresent: state.startIdentity.length > 0,
  };
}

export function readSidecarPresence(stateDir: string): DaemonSidecarPresence {
  return {
    daemonState: pathExists(path.join(stateDir, "daemon.json")),
    world: pathExists(path.join(stateDir, "world.json")),
    bootstrap: pathExists(path.join(stateDir, "bootstrap.json")),
  };
}

export function readCappedText(file: string, maxBytes = STDERR_CAP_BYTES): string {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const stat = fs.fstatSync(fd);
      const size = Number(stat.size);
      const length = Math.min(maxBytes, size);
      if (length <= 0) {
        return "";
      }
      const start = size > maxBytes ? size - maxBytes : 0;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      return buffer.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

export function redactDiagnosticText(
  text: string,
  options: { stateDir: string; extraSecrets?: readonly string[] } = { stateDir: "" },
): { value: string; categories: string[] } {
  const categories = new Set<string>();
  let output = text.replace(/\u0000/g, "");

  const secrets = collectSecretValues(options.extraSecrets);
  for (const secret of secrets) {
    if (secret.length === 0 || !output.includes(secret)) {
      continue;
    }
    output = output.split(secret).join("[REDACTED]");
    categories.add("token");
  }

  const pathPairs = hostPathPlaceholders(options.stateDir);
  for (const [raw, placeholder] of pathPairs) {
    if (raw.length < 2 || !output.includes(raw)) {
      continue;
    }
    output = output.split(raw).join(placeholder);
    categories.add("path");
  }

  output = output.replace(WINDOWS_USER_PATH, () => {
    categories.add("path");
    return "<home>";
  });
  output = output.replace(UNIX_HOME_PATH, () => {
    categories.add("path");
    return "<home>";
  });

  for (const pattern of TOKEN_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    output = output.replace(regex, () => {
      categories.add("token");
      return "[REDACTED]";
    });
  }

  output = output
    .split(/\r?\n/)
    .map((line) => {
      if (!ENV_ASSIGNMENT_LINE.test(line) && !SENSITIVE_ENV_KEY.test(line)) {
        return line;
      }
      const eq = line.indexOf("=");
      if (eq === -1) {
        return line;
      }
      const key = line.slice(0, eq);
      if (SENSITIVE_ENV_KEY.test(key) || ENV_ASSIGNMENT_LINE.test(line)) {
        if (SENSITIVE_ENV_KEY.test(key)) {
          categories.add("env");
          return `${key}=[REDACTED]`;
        }
      }
      return line;
    })
    .join("\n");

  return { value: output, categories: [...categories].sort() };
}

export function classifyLaunchFailure(input: ClassifyLaunchFailureInput): DesktopDaemonDiagnostic {
  const exit = input.child?.exitSnapshot?.() ?? null;
  const stderrRedacted = redactDiagnosticText(input.stderr, { stateDir: input.stateDir });
  const spawnErrorRedacted = input.spawnErrorMessage
    ? redactDiagnosticText(input.spawnErrorMessage, { stateDir: input.stateDir })
    : null;
  const combined = `${stderrRedacted.value}\n${spawnErrorRedacted?.value ?? ""}`;
  const portConflictHint =
    input.portBusy ||
    /\bEADDRINUSE\b/.test(combined) ||
    (input.lockHeld && exit !== null);
  const code = resolveDiagnosticCode({
    preflightMessage: input.preflightMessage ?? null,
    inspectStatus: input.inspectStatus,
    healthFailed: input.healthFailed === true,
    portConflictHint,
    exit,
    spawnError: spawnErrorRedacted?.value ?? null,
    publishedState: input.publishedState,
    spawnAttempted: input.spawnAttempted,
  });
  const categories = new Set<string>([
    ...stderrRedacted.categories,
    ...(spawnErrorRedacted?.categories ?? []),
  ]);
  const message = actionableMessage(code, {
    preflightMessage: input.preflightMessage ?? null,
    exit,
    spawnError: spawnErrorRedacted?.value ?? null,
  });
  return {
    kind: DESKTOP_DIAGNOSTIC_KIND,
    generatedAt: input.now().toISOString(),
    code,
    message,
    inspectStatus: input.inspectStatus,
    exit,
    state: summarizeDaemonState(input.publishedState ?? input.previousState),
    sidecar: readSidecarPresence(input.stateDir),
    stderrExcerpt: stderrRedacted.value.slice(-STDERR_CAP_BYTES),
    redaction: { applied: categories.size > 0, categories: [...categories].sort() },
  };
}

export function writeLaunchDiagnostic(stateDir: string, diagnostic: DesktopDaemonDiagnostic): void {
  const dir = daemonDiagnosticsDir(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = daemonDiagnosticSnapshotPath(stateDir);
  const tmp = `${file}.${process.pid}.tmp`;
  const body = `${JSON.stringify(diagnostic, null, 2)}\n`;
  fs.writeFileSync(tmp, body, "utf8");
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  fs.renameSync(tmp, file);
}

export function recordLaunchDiagnostic(stateDir: string, diagnostic: DesktopDaemonDiagnostic): void {
  try {
    writeLaunchDiagnostic(stateDir, diagnostic);
    if (diagnostic.exit) {
      fs.writeFileSync(daemonStderrLogPath(stateDir), diagnostic.stderrExcerpt, "utf8");
    }
  } catch {
    // Diagnostics must never block reconnect or spawn recovery.
  }
}

export function sessionFailureMessage(error: unknown, stateDir: string): string {
  const raw =
    error instanceof Error ? error.message : "Failed to establish a daemon session";
  const redacted = redactDiagnosticText(raw, { stateDir });
  if (
    redacted.value.length === 0 ||
    redacted.value === "Failed to establish a daemon session"
  ) {
    return "Daemon was reachable but establishing a desktop session failed. A redacted diagnostic was saved. Retry; session tokens are not stored in diagnostics.";
  }
  return `Daemon was reachable but establishing a desktop session failed (${redacted.value}). Retry; session tokens are not stored in diagnostics.`;
}

export function recordSessionFailureDiagnostic(
  stateDir: string,
  error: unknown,
  now: Date,
  publishedState: DaemonStateFile | null,
): void {
  const message = sessionFailureMessage(error, stateDir);
  const excerpt = redactDiagnosticText(
    error instanceof Error ? error.message : String(error),
    { stateDir },
  );
  recordLaunchDiagnostic(stateDir, {
    kind: DESKTOP_DIAGNOSTIC_KIND,
    generatedAt: now.toISOString(),
    code: "health_failed",
    message,
    exit: null,
    state: summarizeDaemonState(publishedState),
    sidecar: readSidecarPresence(stateDir),
    stderrExcerpt: excerpt.value,
    redaction: { applied: excerpt.categories.length > 0, categories: excerpt.categories },
  });
}

function resolveDiagnosticCode(input: {
  preflightMessage?: string | null;
  inspectStatus: InspectStatus;
  healthFailed: boolean;
  portConflictHint: boolean;
  exit: DaemonExitObservation | null;
  spawnError: string | null;
  publishedState: DaemonStateFile | null;
  spawnAttempted: boolean;
}): DaemonDiagnosticCode {
  if (input.preflightMessage) {
    return "preflight";
  }
  if (input.inspectStatus === "stale-identity-mismatch") {
    return "identity_mismatch";
  }
  if (input.inspectStatus === "stale-unhealthy" && !input.publishedState) {
    return "unhealthy_live";
  }
  if (input.portConflictHint) {
    return "port_conflict";
  }
  if (input.spawnError) {
    return "spawn_error";
  }
  if (input.exit) {
    return "crash";
  }
  if (input.healthFailed) {
    return "health_failed";
  }
  if (!input.spawnAttempted && !input.publishedState) {
    return "offline";
  }
  if (!input.publishedState) {
    return "state_not_replaced";
  }
  if (input.inspectStatus === "none") {
    return "offline";
  }
  return "state_not_replaced";
}

function actionableMessage(
  code: DaemonDiagnosticCode,
  input: {
    preflightMessage?: string | null;
    exit: DaemonExitObservation | null;
    spawnError: string | null;
  },
): string {
  switch (code) {
    case "preflight":
      return (
        input.preflightMessage ??
        "Daemon source entry is not supported on this Node version. Install Node >= 22.7 and retry."
      );
    case "port_conflict":
      return "Daemon could not bind because the lock or loopback port is already in use. Confirm the existing instance is stale before retrying; a second Daemon will not be started.";
    case "crash":
      return `Daemon exited before becoming healthy (${formatExit(input.exit)}). A redacted diagnostic was saved. Retry after fixing the cause; closing this window does not stop a healthy Daemon.`;
    case "spawn_error":
      return "Daemon spawn failed before a process was created. A redacted diagnostic was saved. Check that the desktop runtime can execute the Daemon entry, then retry.";
    case "health_failed":
      return "Daemon published state but the health check failed. A redacted diagnostic was saved. Retry; a second instance will not be started while the process still looks live.";
    case "identity_mismatch":
      return "Live process identity does not match the state file. Not attaching and not starting a second Daemon.";
    case "unhealthy_live":
      return "Daemon process is alive but unhealthy. Not killing it and not starting a second instance.";
    case "offline":
      return "A Daemon lock is held but no healthy instance published state. Retry; a second instance will not be started.";
    case "state_not_replaced":
      return "Daemon did not publish a new state file after spawn. A redacted diagnostic was saved. Check Node version and lock or port conflicts, then retry. A second instance will not be started while the process looks live.";
  }
}

function formatExit(exit: DaemonExitObservation | null): string {
  if (!exit) {
    return "exit unknown";
  }
  if (exit.signal) {
    return `signal ${exit.signal}`;
  }
  if (exit.exitCode === null) {
    return "exit unknown";
  }
  return `exit ${exit.exitCode}`;
}

function collectSecretValues(extra: readonly string[] | undefined): string[] {
  const values: string[] = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string" || value.length < 8) {
      continue;
    }
    if (SENSITIVE_ENV_KEY.test(key)) {
      values.push(value);
    }
  }
  if (extra) {
    for (const value of extra) {
      if (value.length >= 8) {
        values.push(value);
      }
    }
  }
  values.sort((a, b) => b.length - a.length);
  return values;
}

function hostPathPlaceholders(stateDir: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const add = (value: string | undefined, token: string) => {
    if (typeof value !== "string" || value.length < 2) {
      return;
    }
    pairs.push([value, token]);
    const normalized = value.replace(/\\/g, "/");
    if (normalized !== value) {
      pairs.push([normalized, token]);
    }
  };
  add(stateDir, "<state-dir>");
  add(os.homedir(), "<home>");
  add(process.env.HOME, "<home>");
  add(process.env.USERPROFILE, "<home>");
  add(process.env.APPDATA, "<appdata>");
  add(process.env.LOCALAPPDATA, "<localappdata>");
  add(process.env.XDG_CONFIG_HOME, "<config>");
  add(process.env.TEMP, "<temp>");
  add(process.env.TMP, "<temp>");
  add(process.env.TMPDIR, "<temp>");
  add(process.execPath, "<exec>");
  add(process.cwd(), "<cwd>");
  pairs.sort((a, b) => b[0].length - a[0].length);
  return pairs;
}

function pathExists(file: string): boolean {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}
