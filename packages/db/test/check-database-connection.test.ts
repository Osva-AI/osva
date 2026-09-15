import { describe, expect, it } from "vitest";

import { checkDatabaseConnection } from "../src/check-database-connection.js";

describe("checkDatabaseConnection", () => {
  it("resolves when ping succeeds", async () => {
    await expect(
      checkDatabaseConnection({
        ping: async () => undefined,
      }),
    ).resolves.toBeUndefined();
  });

  it("throws a safe error that does not leak the driver message", async () => {
    await expect(
      checkDatabaseConnection({
        ping: async () => {
          throw new Error("ECONNREFUSED postgres://secret@127.0.0.1/osva");
        },
      }),
    ).rejects.toThrow("PostgreSQL is unavailable.");

    try {
      await checkDatabaseConnection({
        ping: async () => {
          throw new Error("ECONNREFUSED postgres://secret@127.0.0.1/osva");
        },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain("postgres://");
      expect(String(error)).not.toContain("secret");
      expect(String(error)).not.toContain("ECONNREFUSED");
    }
  });
});
