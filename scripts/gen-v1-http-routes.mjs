/**
 * Developer convenience: copy V1_ROUTE_INVENTORY rows into per-handler V1_HTTP_ROUTES exports.
 * CI verification is read-only — see apps/web/test/v1-route-inventory.test.ts and
 * scripts/lib/v1-http-route-discovery.mjs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const inventoryPath = path.join(repoRoot, "apps/web/src/v1-route-inventory.ts");
const inventorySource = fs.readFileSync(inventoryPath, "utf8");

const blockRe =
  /\{\s*module:\s*"([^"]+)"[\s\S]*?method:\s*"([^"]+)"[\s\S]*?path:\s*"([^"]+)"[\s\S]*?\}/g;
const byModule = new Map();

for (const match of inventorySource.matchAll(blockRe)) {
  const [, module, method, routePath] = match;
  if (!byModule.has(module)) {
    byModule.set(module, []);
  }
  byModule.get(module).push({ method, path: routePath });
}

for (const [module, routes] of byModule) {
  const filePath = path.join(repoRoot, "apps/web/src", `${module}.ts`);
  if (!fs.existsSync(filePath)) {
    console.warn("missing", filePath);
    continue;
  }
  let source = fs.readFileSync(filePath, "utf8");
  source = source.replace(
    /\nexport const V1_HTTP_ROUTES = \[[\s\S]*?\] as const;\n?/,
    "\n",
  );

  const block =
    "\nexport const V1_HTTP_ROUTES = [\n" +
    routes
      .map((r) => `  { method: "${r.method}", path: "${r.path}" },`)
      .join("\n") +
    "\n] as const;\n";

  source = source.trimEnd() + block;
  fs.writeFileSync(filePath, source);
  console.log("updated", module, routes.length);
}

const total = [...byModule.values()].reduce((sum, r) => sum + r.length, 0);
console.log("total routes", total);
