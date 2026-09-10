export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const out: Record<string, unknown> = {};
    for (const [key, nested] of entries) {
      out[key] = canonicalize(nested);
    }
    return out;
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function fnv1a64Hex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export function contentDigest(value: unknown): string {
  return `fnv1a64:${fnv1a64Hex(stableJson(value))}`;
}

export function parsePatchPaths(patch: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const line of patch.split("\n")) {
    if (!line.startsWith("+++ ")) {
      continue;
    }
    let path = line.slice(4).trim();
    if (path.startsWith("b/")) {
      path = path.slice(2);
    }
    if (path === "/dev/null" || path.length === 0) {
      continue;
    }
    if (!seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}
