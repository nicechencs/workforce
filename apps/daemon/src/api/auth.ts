import { randomBytes } from "node:crypto";

export interface Session {
  token: string;
  principalId: string;
  clientId: string;
}

export class SessionRegistry {
  private current: Session | null = null;
  private readonly valid = new Set<string>();

  constructor(
    private readonly principalId: string,
    private readonly clientId: string,
  ) {}

  issue(token?: string): Session {
    const session: Session = {
      token: token ?? randomBytes(32).toString("base64url"),
      principalId: this.principalId,
      clientId: this.clientId,
    };
    for (const old of this.valid) {
      this.valid.delete(old);
    }
    this.valid.add(session.token);
    this.current = session;
    return session;
  }

  rotate(): Session {
    return this.issue();
  }

  resolve(token: string): Session | null {
    if (!this.valid.has(token)) {
      return null;
    }
    return this.current;
  }

  getCurrent(): Session {
    if (!this.current) {
      return this.issue();
    }
    return this.current;
  }
}

export function parseBearer(header: string | undefined): string | null {
  if (header === undefined) {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
