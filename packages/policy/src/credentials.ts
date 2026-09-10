import type { Clock, CredentialRef, InjectRequest, MinimalInjection } from "./types.js";

export type CredentialBrokerErrorCode =
  "not_found" | "revoked" | "expired" | "forbidden_copy" | "invalid_request";

export class CredentialBrokerError extends Error {
  readonly code: CredentialBrokerErrorCode;

  constructor(code: CredentialBrokerErrorCode, message: string) {
    super(message);
    this.name = "CredentialBrokerError";
    this.code = code;
  }
}

export interface SecretStore {
  get(externalSecretId: string): Promise<string | undefined>;
  put(externalSecretId: string, secret: string): Promise<void>;
  delete(externalSecretId: string): Promise<void>;
}

/** In-memory fake of an OS/keychain store. Never a copy of the user env. */
export class InMemorySecretStore implements SecretStore {
  private readonly secrets = new Map<string, string>();

  async get(externalSecretId: string): Promise<string | undefined> {
    return this.secrets.get(externalSecretId);
  }

  async put(externalSecretId: string, secret: string): Promise<void> {
    this.secrets.set(externalSecretId, secret);
  }

  async delete(externalSecretId: string): Promise<void> {
    this.secrets.delete(externalSecretId);
  }

  values(): string[] {
    return [...this.secrets.values()];
  }
}

interface StoredRef {
  ref: CredentialRef;
  externalSecretId: string;
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface CredentialBrokerOptions {
  clock?: Clock;
  secrets?: SecretStore;
}

/**
 * Resolves CredentialRef to a one-key or stdin injection.
 * Refuses to copy process.env or auth.json (D12).
 */
export class InMemoryCredentialBroker {
  private readonly clock: Clock;
  private readonly secrets: SecretStore;
  private readonly refs = new Map<string, StoredRef>();

  constructor(options: CredentialBrokerOptions = {}) {
    this.clock = options.clock ?? { now: () => new Date() };
    this.secrets = options.secrets ?? new InMemorySecretStore();
  }

  async register(
    ref: CredentialRef,
    secret: string,
    externalSecretId?: string,
  ): Promise<CredentialRef> {
    if (secret.length === 0) {
      throw new CredentialBrokerError("invalid_request", "secret must be non-empty");
    }
    const stored: CredentialRef = cloneRef(ref);
    const secretId = externalSecretId ?? ref.id;
    await this.secrets.put(secretId, secret);
    this.refs.set(ref.id, { ref: stored, externalSecretId: secretId });
    return cloneRef(stored);
  }

  async getRef(id: string): Promise<CredentialRef> {
    const stored = this.refs.get(id);
    if (!stored) {
      throw new CredentialBrokerError("not_found", `credential ref not found: ${id}`);
    }
    return cloneRef(stored.ref);
  }

  async revoke(id: string): Promise<void> {
    const stored = this.refs.get(id);
    if (!stored) {
      throw new CredentialBrokerError("not_found", `credential ref not found: ${id}`);
    }
    stored.ref.status = "revoked";
    await this.secrets.delete(stored.externalSecretId);
  }

  async inject(request: InjectRequest): Promise<MinimalInjection> {
    const stored = this.refs.get(request.credentialRefId);
    if (!stored) {
      throw new CredentialBrokerError(
        "not_found",
        `credential ref not found: ${request.credentialRefId}`,
      );
    }
    if (stored.ref.status === "revoked") {
      throw new CredentialBrokerError(
        "revoked",
        `credential ref revoked: ${request.credentialRefId}`,
      );
    }
    if (stored.ref.status === "expired" || this.isExpired(stored.ref)) {
      throw new CredentialBrokerError(
        "expired",
        `credential ref expired: ${request.credentialRefId}`,
      );
    }
    const secret = await this.secrets.get(stored.externalSecretId);
    if (secret === undefined) {
      throw new CredentialBrokerError("not_found", `secret missing for ${request.credentialRefId}`);
    }

    if (request.mode === "stdin") {
      return { credentialRefId: request.credentialRefId, mode: "stdin", stdinSecret: secret };
    }

    const envKey = request.envKey;
    if (envKey === undefined || !ENV_KEY.test(envKey)) {
      throw new CredentialBrokerError(
        "invalid_request",
        "env_key injection requires a valid envKey",
      );
    }
    return {
      credentialRefId: request.credentialRefId,
      mode: "env_key",
      extraEnv: { key: envKey, value: secret },
    };
  }

  /** Overlay for spawn env: zero or one extra key, never `process.env`. */
  materializeOverlay(injection: MinimalInjection): Record<string, string> {
    if (injection.mode !== "env_key" || injection.extraEnv === undefined) {
      return {};
    }
    return { [injection.extraEnv.key]: injection.extraEnv.value };
  }

  secretsForRedaction(): string[] {
    if (this.secrets instanceof InMemorySecretStore) {
      return this.secrets.values();
    }
    return [];
  }

  requestCopyUserEnv(): never {
    throw new CredentialBrokerError(
      "forbidden_copy",
      "refusing to copy the user environment; use CredentialRef + minimal inject",
    );
  }

  requestCopyAuthJson(): never {
    throw new CredentialBrokerError(
      "forbidden_copy",
      "refusing to copy auth.json; ChatGPT login stays in the runtime store",
    );
  }

  private isExpired(ref: CredentialRef): boolean {
    if (ref.expiresAt === undefined) {
      return false;
    }
    return this.clock.now().getTime() >= Date.parse(ref.expiresAt);
  }
}

function cloneRef(ref: CredentialRef): CredentialRef {
  const copy: CredentialRef = {
    id: ref.id,
    provider: ref.provider,
    displayName: ref.displayName,
    scopes: [...ref.scopes],
    status: ref.status,
  };
  if (ref.expiresAt !== undefined) {
    copy.expiresAt = ref.expiresAt;
  }
  if (ref.lastVerifiedAt !== undefined) {
    copy.lastVerifiedAt = ref.lastVerifiedAt;
  }
  if (ref.rotationId !== undefined) {
    copy.rotationId = ref.rotationId;
  }
  return copy;
}
