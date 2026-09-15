import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const memorySrc = path.join(repoRoot, "adapters", "memory", "src");
const domainSrc = path.join(repoRoot, "packages", "domain", "src");
const contractsSrc = path.join(repoRoot, "packages", "contracts", "src");

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

function toRepoPath(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function forbiddenMemoryImport(specifier: string): string | undefined {
  if (specifier === "@osva/db" || specifier.startsWith("@osva/db/")) {
    return "@osva/db";
  }

  if (specifier === "drizzle-orm" || specifier.startsWith("drizzle-orm/")) {
    return "drizzle-orm";
  }

  if (specifier === "postgres" || specifier.startsWith("postgres/")) {
    return "postgres";
  }

  if (specifier === "bullmq" || specifier.startsWith("bullmq/")) {
    return "bullmq";
  }

  if (specifier === "ioredis" || specifier.startsWith("ioredis/")) {
    return "ioredis";
  }

  if (specifier === "redis" || specifier.startsWith("redis/")) {
    return "redis";
  }

  if (specifier === "openai" || specifier.startsWith("openai/")) {
    return "openai";
  }

  if (specifier.startsWith("@anthropic-ai/")) {
    return "@anthropic-ai/*";
  }

  if (specifier === "zod" || specifier.startsWith("zod/")) {
    return "zod";
  }

  return undefined;
}

describe("architecture import restrictions", () => {
  it("forbids infrastructure imports in adapters/memory/src", () => {
    const violations: string[] = [];

    for (const file of walkTypeScriptFiles(memorySrc)) {
      for (const specifier of collectImportSpecifiers(
        fs.readFileSync(file, "utf8"),
      )) {
        const forbidden = forbiddenMemoryImport(specifier);
        if (forbidden) {
          violations.push(
            `${toRepoPath(file)} imports forbidden '${specifier}' (${forbidden})`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps domain and contracts free of adapters-memory imports", () => {
    const violations: string[] = [];

    for (const directory of [domainSrc, contractsSrc]) {
      for (const file of walkTypeScriptFiles(directory)) {
        for (const specifier of collectImportSpecifiers(
          fs.readFileSync(file, "utf8"),
        )) {
          if (
            specifier === "@osva/adapters-memory" ||
            specifier.startsWith("@osva/adapters-memory/")
          ) {
            violations.push(
              `${toRepoPath(file)} imports forbidden '${specifier}'`,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
