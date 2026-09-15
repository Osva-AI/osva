import type { SecretResolver } from "@osva/contracts";
import { describe, expect, it } from "vitest";

import { SecretNotFoundError } from "../src/errors.js";
import { MemorySecretResolver } from "../src/memory-secret-resolver.js";

describe("MemorySecretResolver", () => {
  it("resolves values from the supplied in-memory mapping", async () => {
    const source = { "openai/api-key": "secret-value" };
    const resolver: SecretResolver = new MemorySecretResolver(source);

    source["openai/api-key"] = "mutated";

    await expect(resolver.resolve({ key: "openai/api-key" })).resolves.toBe(
      "secret-value",
    );
  });

  it("throws SecretNotFoundError for unknown references", async () => {
    const resolver: SecretResolver = new MemorySecretResolver({
      known: "value",
    });

    await expect(resolver.resolve({ key: "missing" })).rejects.toThrow(
      SecretNotFoundError,
    );

    try {
      await resolver.resolve({ key: "missing" });
    } catch (error) {
      expect(error).toMatchObject({ key: "missing" });
    }
  });
});
