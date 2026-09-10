import { spawn } from "node:child_process";

export function readWindowsOsStartIdentity(pid: number): Promise<string | null> {
  if (process.platform !== "win32" || !Number.isInteger(pid) || pid <= 0) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if (-not $p) { exit 1 }; $p.StartTime.ToUniversalTime().ToString('o')`,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      const value = out.trim();
      resolve(code === 0 && value.length > 0 ? value : null);
    });
  });
}

export async function readOsStartIdentity(pid: number): Promise<string | null> {
  if (process.platform === "win32") {
    return readWindowsOsStartIdentity(pid);
  }
  return null;
}
