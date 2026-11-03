import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const consoleRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const distClientRoot = path.join(consoleRoot, "dist", "client");
const distIndex = path.join(distClientRoot, "index.html");
const clientSrcRoot = path.join(consoleRoot, "src", "client");

function latestSourceMtimeMs(dir: string): number {
  let latest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, latestSourceMtimeMs(fullPath));
      continue;
    }
    if (!/\.(tsx|ts|css)$/.test(entry.name)) {
      continue;
    }
    latest = Math.max(latest, statSync(fullPath).mtimeMs);
  }
  return latest;
}

function latestDistClientMtimeMs(): number {
  if (!existsSync(distIndex)) {
    return 0;
  }
  let latest = statSync(distIndex).mtimeMs;
  const assetsDir = path.join(distClientRoot, "assets");
  if (!existsSync(assetsDir)) {
    return latest;
  }
  for (const entry of readdirSync(assetsDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    latest = Math.max(
      latest,
      statSync(path.join(assetsDir, entry.name)).mtimeMs,
    );
  }
  return latest;
}

/**
 * Browser integration serves prebuilt assets from dist/client (see m12-3-harness).
 * Rebuild when the bundle is missing or older than client source.
 */
export function ensureConsoleClientDistForBrowserTests(): void {
  const needsBuild =
    !existsSync(distIndex) ||
    latestSourceMtimeMs(clientSrcRoot) > latestDistClientMtimeMs();

  if (!needsBuild) {
    return;
  }

  execSync("pnpm exec vite build", {
    cwd: consoleRoot,
    stdio: "inherit",
  });
}
