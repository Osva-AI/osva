import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  MODEL_BINDING_NAME_PATTERN as CONTRACT_BINDING_PATTERN,
  MODEL_ERROR_CODES,
  MODEL_MAX_OUTPUT_TOKENS_MAX as CONTRACT_MAX_OUTPUT_MAX,
  MODEL_MAX_OUTPUT_TOKENS_MIN as CONTRACT_MAX_OUTPUT_MIN,
  MODEL_TEXT_CONTENT_MAX_LENGTH as CONTRACT_CONTENT_MAX,
  MODEL_TEXT_MAX_MESSAGES as CONTRACT_MAX_MESSAGES,
  MODEL_TEXT_ROLES as CONTRACT_TEXT_ROLES,
} from "@osva/contracts";

import {
  MODEL_BINDING_NAME_PATTERN,
  MODEL_MAX_OUTPUT_TOKENS_MAX,
  MODEL_MAX_OUTPUT_TOKENS_MIN,
  MODEL_TEXT_CONTENT_MAX_LENGTH,
  MODEL_TEXT_MAX_MESSAGES,
  MODEL_TEXT_ROLES,
  ModelErrorCode,
} from "../src/constants.js";
import { isModelGenerateRequestMessage } from "../src/protocol.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const runtimeSrc = path.join(repoRoot, "adapters", "runtime-typescript", "src");

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
  if (specifier === "@osva/db" || specifier.startsWith("@osva/db/")) {
    return "@osva/db";
  }

  if (
    specifier === "@osva/orchestration" ||
    specifier.startsWith("@osva/orchestration/")
  ) {
    return "@osva/orchestration";
  }

  if (specifier === "@osva/web" || specifier.startsWith("@osva/web/")) {
    return "@osva/web";
  }

  if (specifier === "@osva/worker" || specifier.startsWith("@osva/worker/")) {
    return "@osva/worker";
  }

  if (specifier === "bullmq" || specifier.startsWith("bullmq/")) {
    return "bullmq";
  }

  if (specifier === "ioredis" || specifier.startsWith("ioredis/")) {
    return "ioredis";
  }

  if (specifier === "postgres" || specifier.startsWith("postgres/")) {
    return "postgres";
  }

  if (specifier === "drizzle-orm" || specifier.startsWith("drizzle-orm/")) {
    return "drizzle-orm";
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
  it("keeps the trusted TypeScript runtime free of queue, persistence, and provider SDKs", () => {
    const violations: string[] = [];

    for (const file of walkTypeScriptFiles(runtimeSrc)) {
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

  it("keeps the child runner free of runtime @osva/contracts imports", () => {
    const childFiles = [
      "child-runner.ts",
      "child-env.ts",
      "child-json.ts",
      "constants.ts",
      "model-capability.ts",
      "protocol.ts",
      "public-error.ts",
    ];
    const violations: string[] = [];

    for (const fileName of childFiles) {
      const source = fs.readFileSync(path.join(runtimeSrc, fileName), "utf8");
      const statements = source.split(/(?=^import )/m);
      for (const statement of statements) {
        if (
          statement.startsWith("import type ") ||
          !statement.includes('from "@osva/contracts')
        ) {
          continue;
        }

        violations.push(
          `adapters/runtime-typescript/src/${fileName} runtime-imports @osva/contracts`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps child-safe model IPC constants aligned with contracts", () => {
    expect(MODEL_BINDING_NAME_PATTERN.source).toBe(
      CONTRACT_BINDING_PATTERN.source,
    );
    expect([...MODEL_TEXT_ROLES]).toEqual([...CONTRACT_TEXT_ROLES]);
    expect(MODEL_TEXT_CONTENT_MAX_LENGTH).toBe(CONTRACT_CONTENT_MAX);
    expect(MODEL_TEXT_MAX_MESSAGES).toBe(CONTRACT_MAX_MESSAGES);
    expect(MODEL_MAX_OUTPUT_TOKENS_MIN).toBe(CONTRACT_MAX_OUTPUT_MIN);
    expect(MODEL_MAX_OUTPUT_TOKENS_MAX).toBe(CONTRACT_MAX_OUTPUT_MAX);
    expect(ModelErrorCode).toEqual(MODEL_ERROR_CODES);
  });

  it("rejects AbortSignal on serializable model generate IPC requests", () => {
    const valid = {
      v: 1,
      type: "model.generate.request",
      callId: "call-1",
      binding: "primary",
      request: {
        messages: [{ role: "user", content: "Explain OSVA." }],
      },
    };

    expect(isModelGenerateRequestMessage(valid)).toBe(true);
    expect(
      isModelGenerateRequestMessage({
        ...valid,
        request: {
          ...valid.request,
          signal: {},
        },
      }),
    ).toBe(false);
  });
});
