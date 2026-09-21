import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const mcpServerSrc = path.join(repoRoot, "apps", "mcp-server", "src");

const IMPORT_SPECIFIER_PATTERN =
  /(?:(?:import|export)(?:\s+type)?(?:[\s\S]*?\sfrom\s*|\s+)|\bimport\s*\()\s*["']([^"']+)["']/g;

function walkTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTypeScriptFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

function collectImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const uncommented = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  for (const match of uncommented.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    const specifier = match[1];
    if (specifier) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

function forbiddenMcpServerImport(specifier: string): string | undefined {
  if (specifier === "@osva/db" || specifier.startsWith("@osva/db/")) {
    return "@osva/db";
  }
  if (specifier === "@osva/domain" || specifier.startsWith("@osva/domain/")) {
    return "@osva/domain";
  }
  if (
    specifier === "@osva/orchestration" ||
    specifier.startsWith("@osva/orchestration/")
  ) {
    return "@osva/orchestration";
  }
  if (
    specifier === "@osva/tool-gateway" ||
    specifier.startsWith("@osva/tool-gateway/")
  ) {
    return "@osva/tool-gateway";
  }
  if (specifier === "bullmq" || specifier.startsWith("bullmq/")) {
    return "bullmq";
  }
  return undefined;
}

describe("mcp-server architecture import restrictions", () => {
  it("does not import DB, domain, orchestration, or tool gateway", () => {
    const violations: string[] = [];
    for (const file of walkTypeScriptFiles(mcpServerSrc)) {
      const source = fs.readFileSync(file, "utf8");
      for (const specifier of collectImportSpecifiers(source)) {
        const forbidden = forbiddenMcpServerImport(specifier);
        if (forbidden !== undefined) {
          violations.push(`${path.relative(repoRoot, file)} -> ${forbidden}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
