import { AppError } from "../modules/errors.js";

const SECRET_QUERY_KEYS = new Set([
  "token",
  "access_token",
  "session",
  "session_token",
  "authorization",
  "secret",
  "password",
  "bootstrapToken",
]);

export function rejectSecretQuery(url: string): void {
  const q = url.indexOf("?");
  if (q === -1) {
    return;
  }
  const params = new URLSearchParams(url.slice(q + 1));
  for (const key of params.keys()) {
    if (SECRET_QUERY_KEYS.has(key) || key.toLowerCase().includes("token")) {
      throw new AppError("validation_failed", "Secrets must not be placed in the URL");
    }
  }
}

export function asObject(body: unknown, fallbackEmpty = true): Record<string, unknown> {
  if (body === undefined || body === null) {
    if (fallbackEmpty) {
      return {};
    }
    throw new AppError("validation_failed", "JSON object body is required");
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("validation_failed", "JSON object body is required");
  }
  return body as Record<string, unknown>;
}

export function rejectUnknownFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allow = new Set(allowed);
  const unknown = Object.keys(body).filter((key) => !allow.has(key));
  if (unknown.length > 0) {
    throw new AppError("validation_failed", `Unknown fields: ${unknown.join(", ")}`, {
      fields: unknown,
    });
  }
}

export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  if (!(key in body)) {
    return undefined;
  }
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError("validation_failed", `${key} must be a non-empty string`);
  }
  return value;
}

export function requiredString(body: Record<string, unknown>, key: string): string {
  const value = optionalString(body, key);
  if (value === undefined) {
    throw new AppError("validation_failed", `${key} is required`);
  }
  return value;
}

export function optionalInt(body: Record<string, unknown>, key: string): number | undefined {
  if (!(key in body)) {
    return undefined;
  }
  const value = body[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new AppError("validation_failed", `${key} must be an integer`);
  }
  return value;
}

export function parseIfMatch(header: string | string[] | undefined): number | undefined {
  if (header === undefined) {
    return undefined;
  }
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined || raw.length === 0) {
    return undefined;
  }
  const trimmed = raw.trim().replaceAll('"', "");
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1) {
    throw new AppError("validation_failed", "If-Match must be a positive integer revision");
  }
  return n;
}

export function requireIfMatch(header: string | string[] | undefined): number {
  const value = parseIfMatch(header);
  if (value === undefined) {
    throw new AppError("validation_failed", "If-Match is required");
  }
  return value;
}

export function parseLimit(raw: unknown, fallback = 50): number {
  if (raw === undefined) {
    return fallback;
  }
  const n = typeof raw === "number" ? raw : Number(String(raw));
  if (!Number.isInteger(n) || n < 1 || n > 200) {
    throw new AppError("validation_failed", "limit must be an integer between 1 and 200");
  }
  return n;
}

export function queryString(raw: unknown): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (Array.isArray(raw)) {
    const first = raw[0];
    return typeof first === "string" ? first : undefined;
  }
  return typeof raw === "string" ? raw : String(raw);
}

export function queryStringList(raw: unknown): string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item));
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [String(raw)];
}
