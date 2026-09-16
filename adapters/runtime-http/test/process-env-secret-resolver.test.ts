import { describe, expect, it } from "vitest";

import { SecretNotFoundError } from "../src/errors.js";
import { ProcessEnvSecretResolver } from "../src/process-env-secret-resolver.js";

describe("ProcessEnvSecretResolver", () => {
  it("resolves environment values by secret reference key", async () => {
    const resolver = new ProcessEnvSecretResolver({
      OSVA_REMOTE_RUNTIME_TOKEN: "secret-value",
    });
    await expect(
      resolver.resolve({ key: "OSVA_REMOTE_RUNTIME_TOKEN" }),
    ).resolves.toBe("secret-value");
  });

  it("does not treat missing keys as empty credentials", async () => {
    const resolver = new ProcessEnvSecretResolver({});
    await expect(resolver.resolve({ key: "MISSING" })).rejects.toBeInstanceOf(
      SecretNotFoundError,
    );
  });
});
