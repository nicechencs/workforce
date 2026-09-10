const WINDOWS_ENV_KEYS = [
  "PATH",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "TMP",
  "TEMP",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERNAME",
] as const;

const POSIX_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
] as const;

export function mergeMinimalEnv(overlay?: Record<string, string>): Record<string, string> {
  const wanted = new Set(
    (process.platform === "win32" ? WINDOWS_ENV_KEYS : POSIX_ENV_KEYS).map((key) =>
      key.toUpperCase(),
    ),
  );
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }
    if (wanted.has(key.toUpperCase())) {
      out[key] = value;
    }
  }
  if (overlay) {
    for (const [key, value] of Object.entries(overlay)) {
      if (process.platform === "win32") {
        const existing = Object.keys(out).find((item) => item.toUpperCase() === key.toUpperCase());
        if (existing !== undefined) {
          delete out[existing];
        }
      }
      out[key] = value;
    }
  }
  return out;
}
