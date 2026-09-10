import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

let cachedShell: string | undefined;

export function resolveWindowsShell(): string {
  if (cachedShell) {
    return cachedShell;
  }
  const located =
    locateCommand("pwsh.exe") ??
    locateCommand("pwsh") ??
    locateCommand("powershell.exe") ??
    locateCommand("powershell");
  if (located) {
    cachedShell = located;
    return located;
  }
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows";
  cachedShell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return cachedShell;
}

export function resolveJobSupervisorScript(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../scripts/job-supervisor.ps1"),
    path.resolve(here, "../../scripts/job-supervisor.ps1"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`job-supervisor.ps1 not found; tried ${candidates.join(", ")}`);
}

export function tasklistHasPid(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
    const quoted = `"${pid}"`;
    for (const line of out.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || /^INFO:/i.test(trimmed)) {
        continue;
      }
      const parts = parseCsvLine(trimmed);
      if (parts[1] === String(pid) || trimmed.includes(quoted)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function queryWin32StartIdentity(pid: number): string | undefined {
  if (!Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }
  const script = `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p -and $p.StartTime) { Write-Output ('win32:{0}:{1}' -f $p.Id, $p.StartTime.ToUniversalTime().ToString('o')) }`;
  try {
    const out = execFileSync(
      resolveWindowsShell(),
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 15_000,
      },
    )
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith("win32:"));
    return out;
  } catch {
    return undefined;
  }
}

export function snapshotDescendants(
  rootPid: number,
): Array<{ pid: number; startIdentity: string }> {
  if (!Number.isInteger(rootPid) || rootPid <= 0) {
    return [];
  }
  try {
    const raw = execFileSync(
      resolveWindowsShell(),
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        resolveJobSupervisorScript(),
        "-Action",
        "snapshot",
        "-ProcessId",
        String(rootPid),
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 20_000,
      },
    );
    return parseJsonArray(raw);
  } catch {
    return [];
  }
}

export function taskkillPid(pid: number, tree: boolean): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }
  const args = tree ? ["/PID", String(pid), "/T", "/F"] : ["/PID", String(pid), "/F"];
  try {
    execFileSync("taskkill", args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 20_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // already gone or access denied; caller re-checks liveness
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function pollUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 50,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return true;
    }
    await sleep(intervalMs);
  }
  return false;
}

function locateCommand(name: string): string | undefined {
  try {
    const out = execFileSync("where.exe", [name], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8_000,
    });
    return out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
  } catch {
    return undefined;
  }
}

function parseCsvLine(line: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === "," && !inQuotes) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function parseJsonArray(raw: string): Array<{ pid: number; startIdentity: string }> {
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text) {
    return [];
  }
  const start = text.indexOf("[");
  const objectStart = text.indexOf("{");
  const jsonText =
    start >= 0 ? text.slice(start) : objectStart >= 0 ? text.slice(objectStart) : text;
  try {
    const parsed: unknown = JSON.parse(jsonText);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const out: Array<{ pid: number; startIdentity: string }> = [];
    for (const row of rows) {
      if (typeof row !== "object" || row === null) {
        continue;
      }
      const record = row as { pid?: unknown; startIdentity?: unknown };
      if (typeof record.pid === "number" && typeof record.startIdentity === "string") {
        out.push({ pid: record.pid, startIdentity: record.startIdentity });
      }
    }
    return out;
  } catch {
    return [];
  }
}
