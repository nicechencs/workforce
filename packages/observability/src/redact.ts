export const REDACTION_POLICY_VERSION = "0.1.0" as const;
export const REDACTED = "[REDACTED]" as const;

export interface RedactionSummary {
  applied: boolean;
  policyVersion: string;
  categories: string[];
  replacements: number;
}

export interface RedactionResult<T> {
  value: T;
  summary: RedactionSummary;
}

const SENSITIVE_KEY =
  /^(password|passwd|secret|token|access_token|refresh_token|id_token|api_?key|authorization|private_key|openai_api_key|session_token|client_secret|auth_token|chatgpt_api_key|codex_api_key)$/iu;

type Pattern = { category: string; regex: RegExp };

const PATTERNS: readonly Pattern[] = [
  {
    category: "private_key",
    regex:
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  { category: "token", regex: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}\b/g },
  { category: "token", regex: /\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{36}\b/g },
  { category: "token", regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { category: "authorization", regex: /\bBearer\s+[A-Za-z0-9._\-+=/]+\b/gi },
  { category: "token", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { category: "connection_string", regex: /\b(?:postgres|mysql|mongodb|redis):\/\/[^\s"'<>]+/gi },
  { category: "auth_json", regex: /"OPENAI_API_KEY"\s*:\s*"[^"]*"/g },
  { category: "path", regex: /\b[A-Za-z]:\\Users\\[^\\/\s"']+/g },
  { category: "email", regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
];

export interface SecretRedactorOptions {
  knownSecrets?: readonly string[];
  policyVersion?: string;
  lookbehind?: number;
}

export class SecretRedactor {
  readonly policyVersion: string;
  readonly lookbehind: number;
  private readonly knownSecrets: string[];

  constructor(options: SecretRedactorOptions = {}) {
    this.policyVersion = options.policyVersion ?? REDACTION_POLICY_VERSION;
    this.lookbehind = options.lookbehind ?? 512;
    this.knownSecrets = [...(options.knownSecrets ?? [])]
      .filter((secret) => secret.length > 0)
      .sort((a, b) => b.length - a.length);
  }

  registerSecret(secret: string): void {
    if (secret.length === 0) {
      return;
    }
    this.knownSecrets.push(secret);
    this.knownSecrets.sort((a, b) => b.length - a.length);
  }

  emptySummary(): RedactionSummary {
    return { applied: false, policyVersion: this.policyVersion, categories: [], replacements: 0 };
  }

  holdWindow(): number {
    let longest = 0;
    for (const secret of this.knownSecrets) {
      if (secret.length > longest) {
        longest = secret.length;
      }
    }
    return Math.max(this.lookbehind, longest);
  }

  redactText(text: string): RedactionResult<string> {
    const categories = new Set<string>();
    let replacements = 0;
    let output = text;

    for (const secret of this.knownSecrets) {
      if (!output.includes(secret)) {
        continue;
      }
      const pieces = output.split(secret);
      const hits = pieces.length - 1;
      if (hits > 0) {
        output = pieces.join(REDACTED);
        replacements += hits;
        categories.add("known_secret");
      }
    }

    for (const pattern of PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      output = output.replace(regex, () => {
        replacements += 1;
        categories.add(pattern.category);
        return REDACTED;
      });
    }

    return { value: output, summary: this.summaryFrom(categories, replacements) };
  }

  redactJson(value: unknown): RedactionResult<unknown> {
    const categories = new Set<string>();
    let replacements = 0;
    const rewritten = this.walk(value, categories, (n) => {
      replacements += n;
    });
    return { value: rewritten, summary: this.summaryFrom(categories, replacements) };
  }

  redactError(error: unknown): RedactionResult<{ message: string; details?: unknown }> {
    if (error instanceof Error) {
      const message = this.redactText(error.message);
      const details = this.redactJson({ name: error.name, stack: error.stack });
      return {
        value: { message: message.value, details: details.value },
        summary: mergeSummaries(this.policyVersion, [message.summary, details.summary]),
      };
    }
    if (typeof error === "object" && error !== null && "message" in error) {
      const record = error as { message: unknown; details?: unknown };
      const message =
        typeof record.message === "string"
          ? this.redactText(record.message)
          : { value: REDACTED, summary: this.emptySummary() };
      const details = record.details === undefined ? undefined : this.redactJson(record.details);
      const value: { message: string; details?: unknown } = { message: message.value };
      if (details !== undefined) {
        value.details = details.value;
      }
      return {
        value,
        summary: mergeSummaries(this.policyVersion, [message.summary, details?.summary]),
      };
    }
    const json = this.redactJson(error);
    return { value: { message: REDACTED, details: json.value }, summary: json.summary };
  }

  redactRaw(payload: unknown): RedactionResult<unknown> {
    return this.redactJson(payload);
  }

  createStream(): RedactionStream {
    return new RedactionStream(this);
  }

  private walk(
    value: unknown,
    categories: Set<string>,
    addReplacements: (n: number) => void,
  ): unknown {
    if (typeof value === "string") {
      const result = this.redactText(value);
      for (const category of result.summary.categories) {
        categories.add(category);
      }
      addReplacements(result.summary.replacements);
      return result.value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.walk(item, categories, addReplacements));
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (SENSITIVE_KEY.test(key)) {
          out[key] = REDACTED;
          categories.add(categoryForKey(key));
          addReplacements(1);
          continue;
        }
        out[key] = this.walk(nested, categories, addReplacements);
      }
      return out;
    }
    return value;
  }

  private summaryFrom(categories: Set<string>, replacements: number): RedactionSummary {
    return {
      applied: replacements > 0,
      policyVersion: this.policyVersion,
      categories: [...categories].sort(),
      replacements,
    };
  }
}

export class RedactionStream {
  private buffer = "";
  private emitted = 0;
  private readonly redactor: SecretRedactor;

  constructor(redactor: SecretRedactor) {
    this.redactor = redactor;
  }

  push(chunk: string): string {
    this.buffer += chunk;
    const redacted = this.redactor.redactText(this.buffer).value;
    const hold = Math.min(this.redactor.holdWindow(), redacted.length);
    const safeEnd = redacted.length - hold;
    if (safeEnd <= this.emitted) {
      return "";
    }
    const out = redacted.slice(this.emitted, safeEnd);
    this.emitted = safeEnd;
    return out;
  }

  flush(): string {
    const redacted = this.redactor.redactText(this.buffer).value;
    const out = redacted.slice(this.emitted);
    this.buffer = "";
    this.emitted = 0;
    return out;
  }
}

export function mergeSummaries(
  policyVersion: string,
  summaries: Array<RedactionSummary | undefined>,
): RedactionSummary {
  const categories = new Set<string>();
  let replacements = 0;
  for (const summary of summaries) {
    if (!summary) {
      continue;
    }
    replacements += summary.replacements;
    for (const category of summary.categories) {
      categories.add(category);
    }
  }
  return {
    applied: replacements > 0,
    policyVersion,
    categories: [...categories].sort(),
    replacements,
  };
}

function categoryForKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.includes("password") || lower.includes("passwd")) {
    return "password";
  }
  if (lower.includes("authorization")) {
    return "authorization";
  }
  if (lower.includes("private")) {
    return "private_key";
  }
  if (lower.includes("openai") || lower.includes("auth")) {
    return "auth_json";
  }
  return "token";
}
