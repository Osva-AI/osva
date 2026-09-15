import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("root db:migrate build ordering", () => {
  it("builds @osva/db through Turbo so workspace dependencies are built first", () => {
    const rootPackage = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { scripts?: { "db:migrate"?: string } };
    const turboConfig = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "turbo.json"), "utf8"),
    ) as { tasks?: { build?: { dependsOn?: string[] } } };
    const dbPackage = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "packages", "db", "package.json"),
        "utf8",
      ),
    ) as { dependencies?: Record<string, string> };

    const migrateScript = rootPackage.scripts?.["db:migrate"] ?? "";

    expect(migrateScript).toContain("turbo run build --filter=@osva/db");
    expect(migrateScript).toContain("pnpm --filter @osva/db migrate");
    expect(migrateScript).not.toContain("pnpm --filter @osva/db build");
    expect(turboConfig.tasks?.build?.dependsOn).toContain("^build");
    expect(dbPackage.dependencies).toMatchObject({
      "@osva/contracts": "workspace:*",
      "@osva/domain": "workspace:*",
    });
  });
});
