/**
 * Execution-scoped capability credential. Tokens are never exposed in logs,
 * repr output, or thrown errors.
 */
export class CapabilityCredential {
  readonly endpoint: string;

  constructor(
    endpoint: string,
    private readonly token: string,
  ) {
    this.endpoint = endpoint.replace(/\/+$/, "");
  }

  authorizationHeader(): string {
    return `Bearer ${this.token}`;
  }

  toJSON(): { endpoint: string; token: string } {
    return {
      endpoint: this.endpoint,
      token: "[REDACTED]",
    };
  }

  toString(): string {
    return `CapabilityCredential(${this.endpoint})`;
  }

  inspect(): string {
    return this.toString();
  }
}
