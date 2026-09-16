import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const gatewaySrc = path.join(repoRoot, "packages", "model-gateway", "src");

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

function forbiddenImport(specifier: string): string | undefined {
  if (specifier === "@osva/web" || specifier.startsWith("@osva/web/")) {
    return "@osva/web";
  }

  if (specifier === "@osva/worker" || specifier.startsWith("@osva/worker/")) {
    return "@osva/worker";
  }

  if (specifier === "@osva/db" || specifier.startsWith("@osva/db/")) {
    return "@osva/db";
  }

  if (
    specifier.startsWith("@osva/adapters-") ||
    specifier.startsWith("@osva/adapters/")
  ) {
    return "@osva/adapters-*";
  }

  if (specifier === "openai" || specifier.startsWith("openai/")) {
    return "openai";
  }

  if (specifier.startsWith("@anthropic-ai/")) {
    return "@anthropic-ai/*";
  }

  if (specifier === "bullmq" || specifier.startsWith("bullmq/")) {
    return "bullmq";
  }

  return undefined;
}

describe("architecture import restrictions", () => {
  it("keeps ModelGateway free of provider SDKs and adapters", () => {
    const violations: string[] = [];

    for (const file of walkTypeScriptFiles(gatewaySrc)) {
      for (const specifier of collectImportSpecifiers(
        fs.readFileSync(file, "utf8"),
      )) {
        const forbidden = forbiddenImport(specifier);
        if (forbidden) {
          violations.push(
            `${toRepoPath(file)} imports forbidden '${specifier}' (${forbidden})`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps @osva/contracts free of Node ambient types and AbortSignal", () => {
    const contractsRoot = path.join(repoRoot, "packages", "contracts");
    const tsconfig = JSON.parse(
      fs.readFileSync(path.join(contractsRoot, "tsconfig.json"), "utf8"),
    ) as { compilerOptions?: { types?: string[] } };
    const testTsconfig = JSON.parse(
      fs.readFileSync(path.join(contractsRoot, "tsconfig.test.json"), "utf8"),
    ) as { compilerOptions?: { types?: string[] } };
    const source = fs.readFileSync(
      path.join(contractsRoot, "src", "model-gateway.ts"),
      "utf8",
    );

    expect(tsconfig.compilerOptions?.types).toBeUndefined();
    expect(testTsconfig.compilerOptions?.types).toBeUndefined();
    expect(source).not.toContain("AbortSignal");
    expect(source).not.toMatch(/\bsignal\s*\?:/);
  });
});
