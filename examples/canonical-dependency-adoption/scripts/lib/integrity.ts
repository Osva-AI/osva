import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { SHA256_INTEGRITY_PREFIX } from "@osva-ai/contracts";

export function sha256IntegrityOf(content: Buffer | string): string {
  return `${SHA256_INTEGRITY_PREFIX}${createHash("sha256")
    .update(content)
    .digest("hex")}`;
}

export async function sha256IntegrityOfFile(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return sha256IntegrityOf(bytes);
}

export function isSha256IntegrityDigest(value: string): boolean {
  if (!value.startsWith(SHA256_INTEGRITY_PREFIX)) {
    return false;
  }
  const hex = value.slice(SHA256_INTEGRITY_PREFIX.length);
  return /^[0-9a-fA-F]{64}$/.test(hex);
}
