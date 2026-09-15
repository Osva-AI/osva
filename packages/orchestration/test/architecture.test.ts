import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const orchestrationSrc = path.join(
  repoRoot,
  "packages",
  "orchestration",
  "src",
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

function toRepoPath(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function forbiddenOrchestrationImport(specifier: string): string | undefined {
  if (specifier === "@osva/db" || specifier.startsWith("@osva/db/")) {
    return "@osva/db";
  }

  if (
    specifier.startsWith("@osva/adapters-") ||
    specifier.startsWith("@osva/adapters/")
  ) {
    return "@osva/adapters-*";
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

  return undefined;
}

describe("architecture import restrictions", () => {
  it("keeps packages/orchestration/src free of concrete adapters and persistence", () => {
    const violations: string[] = [];

    for (const file of walkTypeScriptFiles(orchestrationSrc)) {
      for (const specifier of collectImportSpecifiers(
        fs.readFileSync(file, "utf8"),
      )) {
        const forbidden = forbiddenOrchestrationImport(specifier);
        if (forbidden) {
          violations.push(
            `${toRepoPath(file)} imports forbidden '${specifier}' (${forbidden})`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
