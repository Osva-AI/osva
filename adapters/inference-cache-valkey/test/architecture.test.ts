import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const adapterSrc = path.join(
  repoRoot,
  "adapters",
  "inference-cache-valkey",
  "src",
);
const unitTestDir = path.join(
  repoRoot,
  "adapters",
  "inference-cache-valkey",
  "test",
);

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

describe("inference-cache-valkey architecture", () => {
  it("keeps unit tests free of Valkey harness imports", () => {
    const violations: string[] = [];
    for (const file of walkTypeScriptFiles(unitTestDir)) {
      if (file.includes(`${path.sep}integration${path.sep}`)) {
        continue;
      }
      for (const specifier of collectImportSpecifiers(
        fs.readFileSync(file, "utf8"),
      )) {
        if (specifier.includes("valkey-harness")) {
          violations.push(specifier);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("does not import domain, worker, or web from src", () => {
    const violations: string[] = [];
    for (const file of walkTypeScriptFiles(adapterSrc)) {
      for (const specifier of collectImportSpecifiers(
        fs.readFileSync(file, "utf8"),
      )) {
        if (
          specifier === "@osva/domain" ||
          specifier.startsWith("@osva/domain/") ||
          specifier === "@osva/worker" ||
          specifier === "@osva/web"
        ) {
          violations.push(specifier);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
