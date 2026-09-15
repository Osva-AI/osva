import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const composePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docker-compose.yml",
);

describe("local Docker Compose topology", () => {
  const compose = fs.readFileSync(composePath, "utf8");

  it("pins PostgreSQL 17 and Valkey without application containers", () => {
    expect(compose).toContain("image: postgres:17-alpine");
    expect(compose).toContain("image: valkey/valkey:8-alpine");
    expect(compose).toContain("POSTGRES_DB: osva");
    expect(compose).toContain("POSTGRES_USER: osva");
    expect(compose).toContain("POSTGRES_PASSWORD: osva");
    expect(compose).not.toMatch(/^[\t ]+web:/m);
    expect(compose).not.toMatch(/^[\t ]+worker:/m);
  });
});
