import type { SecretReference, SecretResolver } from "@osva/contracts";

import { SecretNotFoundError } from "./errors.js";

/**
 * In-memory SecretResolver for tests.
 * Values come only from the mapping supplied at construction.
 */
export class MemorySecretResolver implements SecretResolver {
  private readonly secrets: ReadonlyMap<string, string>;

  constructor(secrets: Readonly<Record<string, string>> = {}) {
    this.secrets = new Map(Object.entries(secrets));
  }

  async resolve(secretReference: SecretReference): Promise<string> {
    const value = this.secrets.get(secretReference.key);

    if (value === undefined) {
      throw new SecretNotFoundError(secretReference.key);
    }

    return value;
  }
}
