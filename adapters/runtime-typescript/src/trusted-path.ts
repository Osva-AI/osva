import fs from "node:fs/promises";
import path from "node:path";

import { isRelativeTrustedEntrypoint } from "@osva/contracts";

import { RuntimeErrorCode } from "./constants.js";

export class TrustedPathError extends Error {
  readonly code:
    | typeof RuntimeErrorCode.PATH_ESCAPE
    | typeof RuntimeErrorCode.ARTIFACT_NOT_FOUND
    | typeof RuntimeErrorCode.INVALID_DESCRIPTOR;

  constructor(code: TrustedPathError["code"], message: string) {
    super(message);
    this.name = "TrustedPathError";
    this.code = code;
  }
}

export async function resolveTrustedRuntimeRoot(
  configuredRoot: string,
): Promise<string> {
  const trimmed = configuredRoot.trim();
  if (trimmed.length === 0) {
    throw new TrustedPathError(
      RuntimeErrorCode.INVALID_DESCRIPTOR,
      "Trusted runtime root is required.",
    );
  }

  let rootReal: string;
  try {
    rootReal = await fs.realpath(trimmed);
  } catch {
    throw new TrustedPathError(
      RuntimeErrorCode.ARTIFACT_NOT_FOUND,
      "Trusted runtime root is not a readable directory.",
    );
  }

  const stats = await fs.stat(rootReal);
  if (!stats.isDirectory()) {
    throw new TrustedPathError(
      RuntimeErrorCode.INVALID_DESCRIPTOR,
      "Trusted runtime root is not a readable directory.",
    );
  }

  return rootReal;
}

export async function resolveTrustedEntrypoint(
  rootReal: string,
  entrypoint: string,
): Promise<string> {
  if (!isRelativeTrustedEntrypoint(entrypoint)) {
    throw new TrustedPathError(
      RuntimeErrorCode.PATH_ESCAPE,
      "Trusted runtime entrypoint must stay beneath the configured runtime root.",
    );
  }

  const candidate = path.resolve(rootReal, entrypoint);
  if (!isInsideRoot(rootReal, candidate)) {
    throw new TrustedPathError(
      RuntimeErrorCode.PATH_ESCAPE,
      "Trusted runtime entrypoint must stay beneath the configured runtime root.",
    );
  }

  let fileReal: string;
  try {
    fileReal = await fs.realpath(candidate);
  } catch {
    throw new TrustedPathError(
      RuntimeErrorCode.ARTIFACT_NOT_FOUND,
      "Trusted runtime entrypoint was not found.",
    );
  }

  if (!isInsideRoot(rootReal, fileReal)) {
    throw new TrustedPathError(
      RuntimeErrorCode.PATH_ESCAPE,
      "Trusted runtime entrypoint must stay beneath the configured runtime root.",
    );
  }

  const stats = await fs.stat(fileReal);
  if (!stats.isFile()) {
    throw new TrustedPathError(
      RuntimeErrorCode.ARTIFACT_NOT_FOUND,
      "Trusted runtime entrypoint was not found.",
    );
  }

  return fileReal;
}

export function isInsideRoot(rootReal: string, targetReal: string): boolean {
  const relative = path.relative(rootReal, targetReal);
  if (relative.length === 0) {
    return false;
  }

  if (path.isAbsolute(relative)) {
    return false;
  }

  const parentTraversal = `..${path.sep}`;
  return relative !== ".." && !relative.startsWith(parentTraversal);
}
