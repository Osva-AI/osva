import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const adapterSrc = path.join(repoRoot, "adapters", "bullmq", "src");
const domainSrc = path.join(repoRoot, "packages", "domain", "src");
const contractsSrc = path.join(repoRoot, "packages", "contracts", "src");
const orchestrationSrc = path.join(
  repoRoot,
  "packages",
  "orchestration",
  "src",
);
const runtimeSrc = path.join(repoRoot, "packages", "runtime-core", "src");

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

function forbiddenAdapterImport(specifier: string): string | undefined {
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
    specifier === "@osva/runtime-core" ||
    specifier.startsWith("@osva/runtime-core/")
  ) {
    return "@osva/runtime-core";
  }

  if (specifier === "@osva/db" || specifier.startsWith("@osva/db/")) {
    return "@osva/db";
  }

  if (specifier === "@osva/web" || specifier.startsWith("@osva/web/")) {
    return "@osva/web";
  }

  if (specifier === "@osva/worker" || specifier.startsWith("@osva/worker/")) {
    return "@osva/worker";
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
  it("keeps adapters/bullmq/src free of domain, orchestration, and apps", () => {
    const violations: string[] = [];

    for (const file of walkTypeScriptFiles(adapterSrc)) {
      for (const specifier of collectImportSpecifiers(
        fs.readFileSync(file, "utf8"),
      )) {
        const forbidden = forbiddenAdapterImport(specifier);
        if (forbidden) {
          violations.push(
            `${toRepoPath(file)} imports forbidden '${specifier}' (${forbidden})`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps domain, contracts, orchestration, and runtime-core free of BullMQ", () => {
    const violations: string[] = [];

    for (const directory of [
      domainSrc,
      contractsSrc,
      orchestrationSrc,
      runtimeSrc,
    ]) {
      for (const file of walkTypeScriptFiles(directory)) {
        for (const specifier of collectImportSpecifiers(
          fs.readFileSync(file, "utf8"),
        )) {
          if (
            specifier === "bullmq" ||
            specifier.startsWith("bullmq/") ||
            specifier === "ioredis" ||
            specifier.startsWith("ioredis/") ||
            specifier === "@osva/adapters-bullmq" ||
            specifier.startsWith("@osva/adapters-bullmq/")
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
