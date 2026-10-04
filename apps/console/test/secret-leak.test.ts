import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function ensureBuiltClient(): void {
  const indexPath = path.join(packageRoot, "dist", "client", "index.html");
  if (!existsSync(indexPath)) {
    execSync("pnpm exec vite build", {
      cwd: packageRoot,
      stdio: "pipe",
    });
  }
}

function readBuiltClientAssets(): string {
  ensureBuiltClient();
  const clientDir = path.join(packageRoot, "dist", "client");
  const assetFiles = readdirSync(clientDir, { recursive: true })
    .map((entry) => path.join(clientDir, String(entry)))
    .filter(
      (filePath) => filePath.endsWith(".js") || filePath.endsWith(".html"),
    );

  return assetFiles
    .map((filePath) => readFileSync(filePath, "utf8"))
    .join("\n");
}

describe("console frontend secret isolation", () => {
  it("does not embed OSVA_CONSOLE_API_KEY in built client assets", () => {
    const combined = readBuiltClientAssets();
    expect(combined).not.toContain("OSVA_CONSOLE_API_KEY");
    expect(combined).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{8,}/);
  }, 60_000);
});
