import { readFile } from "node:fs/promises";
import path from "node:path";

import type { JsonValue } from "@osva-ai/contracts";

import { resolvePathInsideRoot } from "../validate/safe-path.js";
import { ProjectConfigurationError } from "./errors.js";

export async function parseRunInput(input: {
  readonly projectDir: string;
  readonly flags: Readonly<Record<string, string | boolean>>;
}): Promise<JsonValue> {
  const hasInput = typeof input.flags.input === "string";
  const hasInputFile = typeof input.flags["input-file"] === "string";

  if (hasInput && hasInputFile) {
    throw new ProjectConfigurationError(
      "Use either --input or --input-file, not both.",
    );
  }

  if (hasInput) {
    return parseInlineJson(input.flags.input as string);
  }

  if (hasInputFile) {
    const relative = input.flags["input-file"] as string;
    if (path.isAbsolute(relative)) {
      throw new ProjectConfigurationError(
        "Input file path must be relative to the project directory.",
      );
    }
    let filePath: string;
    try {
      filePath = resolvePathInsideRoot(
        input.projectDir,
        ...relative.split("/"),
      );
    } catch {
      throw new ProjectConfigurationError(
        "Input file path must stay inside the project directory.",
      );
    }
    const raw = await readFile(filePath, "utf8");
    return parseInlineJson(raw);
  }

  throw new ProjectConfigurationError(
    "Run input is required. Pass --input JSON or --input-file path.",
  );
}

function parseInlineJson(raw: string): JsonValue {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ProjectConfigurationError("Run input JSON is empty.");
  }
  try {
    return JSON.parse(trimmed) as JsonValue;
  } catch {
    throw new ProjectConfigurationError("Run input is not valid JSON.");
  }
}
