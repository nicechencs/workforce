export type SqlValue = null | number | bigint | string;

export function requiredText(value: SqlValue | undefined, column: string): string {
  if (typeof value !== "string") {
    throw new Error(`expected text column ${column}`);
  }
  return value;
}

export function optionalText(value: SqlValue | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("expected text or null");
  }
  return value;
}

export function requiredInt(value: SqlValue | undefined, column: string): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value !== "number") {
    throw new Error(`expected integer column ${column}`);
  }
  return value;
}

export function optionalInt(value: SqlValue | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value !== "number") {
    throw new Error("expected integer or null");
  }
  return value;
}

export function asJsonText(value: unknown): string {
  return JSON.stringify(value);
}

export function parseJson(value: SqlValue | undefined, column: string): unknown {
  const text = requiredText(value, column);
  return JSON.parse(text) as unknown;
}

/** Omit null/undefined so application optional fields stay absent. */
export function ifPresent<K extends string>(
  key: K,
  value: string | null | undefined,
): Partial<Record<K, string>> {
  if (value === null || value === undefined) {
    return {};
  }
  return { [key]: value } as Record<K, string>;
}

export function cell(row: Record<string, unknown>, column: string): SqlValue | undefined {
  const value = row[column];
  if (value === undefined) {
    return undefined;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  throw new Error(`unexpected sqlite value in ${column}`);
}
