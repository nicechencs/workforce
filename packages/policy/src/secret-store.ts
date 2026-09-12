export type CredentialBrokerErrorCode =
  | "not_found"
  | "revoked"
  | "expired"
  | "forbidden_copy"
  | "invalid_request"
  | "unsupported_capability";

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
