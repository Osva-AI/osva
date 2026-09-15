import { describe, expect, it } from "vitest";

import { createChildEnvironment } from "../src/child-env.js";

describe("createChildEnvironment", () => {
  it("omits OSVA database and Valkey secrets", () => {
    const env = createChildEnvironment({
      PATH: "/usr/bin",
      OSVA_DATABASE_URL: "postgres://secret@127.0.0.1/osva",
      OSVA_VALKEY_URL: "redis://secret@127.0.0.1/0",
      NODE_OPTIONS: "--require ./inject.js",
    });

    expect(env.PATH).toBe("/usr/bin");
    expect(env.OSVA_DATABASE_URL).toBeUndefined();
    expect(env.OSVA_VALKEY_URL).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  it("omits OPENAI_API_KEY from the trusted child environment", () => {
    const env = createChildEnvironment({
      PATH: "/usr/bin",
      OPENAI_API_KEY: "sk-secret-child-must-not-see",
      OSVA_DATABASE_URL: "postgres://secret@127.0.0.1/osva",
    });

    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(JSON.stringify(env)).not.toContain("sk-secret");
  });
});
