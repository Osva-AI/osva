import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const CLIENT_DIST_RELATIVE = path.join("dist", "client", "index.html");

/**
 * Reads built client JS/HTML for static analysis tests (secret isolation).
 * Does not invoke Vite; assets must come from `pnpm --filter @osva/console build`.
 */
export function readBuiltClientAssets(packageRoot: string): string {
  const indexPath = path.join(packageRoot, CLIENT_DIST_RELATIVE);
  if (!existsSync(indexPath)) {
    throw new Error(
      [
        "Console client bundle is missing (expected dist/client/index.html).",
        "Build before running tests: pnpm --filter @osva/console build",
        "In CI, Turbo should run @osva/console#build before @osva/console#test.",
      ].join(" "),
    );
  }

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
