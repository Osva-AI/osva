import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const adapterRoot = path.join(repoRoot, "adapters", "runtime-container");
const adapterSrc = path.join(adapterRoot, "src");
const contractsSrc = path.join(repoRoot, "packages", "contracts", "src");

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

  const pattern =
    /(?:(?:import|export)(?:\s+type)?(?:[\s\S]*?\sfrom\s*|\s+)|\bimport\s*\()\s*["']([^"']+)["']/g;

  for (const match of uncommented.matchAll(pattern)) {
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
    specifier === "@osva/model-gateway" ||
    specifier.startsWith("@osva/model-gateway/")
  ) {
    return "@osva/model-gateway";
  }

  if (
    specifier === "@osva/tool-gateway" ||
    specifier.startsWith("@osva/tool-gateway/")
  ) {
    return "@osva/tool-gateway";
  }

  if (
    specifier === "@osva/memory-gateway" ||
    specifier.startsWith("@osva/memory-gateway/")
  ) {
    return "@osva/memory-gateway";
  }

  if (specifier === "@osva/db" || specifier.startsWith("@osva/db/")) {
    return "@osva/db";
  }

  if (specifier === "bullmq" || specifier.startsWith("bullmq/")) {
    return "bullmq";
  }

  return undefined;
}

describe("runtime-container architecture", () => {
  it("keeps the adapter free of domain, orchestration, and gateway imports", () => {
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

  it("keeps docker engine dependencies out of public contracts", () => {
    const violations: string[] = [];

    for (const file of walkTypeScriptFiles(contractsSrc)) {
      for (const specifier of collectImportSpecifiers(
        fs.readFileSync(file, "utf8"),
      )) {
        if (specifier === "dockerode" || specifier.startsWith("dockerode/")) {
          violations.push(`${toRepoPath(file)} imports dockerode`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps dockerode imports confined to the Docker client module", () => {
    const violations: string[] = [];

    for (const file of walkTypeScriptFiles(adapterSrc)) {
      if (path.basename(file) === "dockerode-client.ts") {
        continue;
      }

      for (const specifier of collectImportSpecifiers(
        fs.readFileSync(file, "utf8"),
      )) {
        if (specifier === "dockerode" || specifier.startsWith("dockerode/")) {
          violations.push(`${toRepoPath(file)} imports dockerode`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
