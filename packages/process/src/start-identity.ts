export const UNTESTED_PROCESS_PLATFORMS = ["darwin"] as const;
/** Empty: win32 captured spawn is implemented via Job Object; spawn still fail-closes if capture is unavailable. */
export const UNSUPPORTED_CAPTURED_PROCESS_PLATFORMS: readonly string[] = [];
export const UNTESTED_CAPTURED_PROCESS_PLATFORMS = ["darwin"] as const;

export function formatWin32StartIdentity(pid: number, createTimeUtc: Date | string): string {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`invalid pid: ${pid}`);
  }
  const iso =
    typeof createTimeUtc === "string"
      ? normalizeWin32CreateTime(createTimeUtc)
      : formatDotNetRoundTripUtc(createTimeUtc);
  return `win32:${pid}:${iso}`;
}

export function identityMismatchError(
  handle: { pid: number; startIdentity: string },
  observed: string | undefined,
): Error {
  const err = new Error(
    `identity_mismatch: pid ${handle.pid} handle startIdentity=${handle.startIdentity} observed=${observed ?? "<missing>"}`,
  );
  err.name = "IdentityMismatchError";
  Object.assign(err, { code: "identity_mismatch" });
  return err;
}

function normalizeWin32CreateTime(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid createTimeUtc: ${value}`);
  }
  return formatDotNetRoundTripUtc(parsed);
}

function formatDotNetRoundTripUtc(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error("invalid createTimeUtc Date");
  }
  const iso = date.toISOString();
  const match = /^(.+\.)(\d{3})Z$/.exec(iso);
  if (match?.[1] === undefined || match[2] === undefined) {
    return iso;
  }
  return `${match[1]}${match[2]}0000Z`;
}
