import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { SHA256_INTEGRITY_PREFIX } from "@osva-ai/contracts";

export function sha256IntegrityOf(content: Buffer | string): string {
  return `${SHA256_INTEGRITY_PREFIX}${createHash("sha256")
    .update(content)
    .digest("hex")
    .toLowerCase()}`;
}

export async function sha256IntegrityOfFile(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return sha256IntegrityOf(bytes);
}

export function normalizeIntegrityDigest(value: string): string | undefined {
  if (!value.startsWith(SHA256_INTEGRITY_PREFIX)) {
    return undefined;
  }
  const hex = value.slice(SHA256_INTEGRITY_PREFIX.length);
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    return undefined;
  }
  return `${SHA256_INTEGRITY_PREFIX}${hex.toLowerCase()}`;
}
