import type { SecretReference, SecretResolver } from "@osva/contracts";

import { SecretNotFoundError } from "./errors.js";

/**
 * Resolves SecretReferences from process environment values.
 * Secret values are never logged by this resolver.
 */
export class ProcessEnvSecretResolver implements SecretResolver {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async resolve(secretReference: SecretReference): Promise<string> {
    const value = this.env[secretReference.key]?.trim() ?? "";
    if (value.length === 0) {
      throw new SecretNotFoundError(secretReference.key);
    }

    return value;
  }
}
