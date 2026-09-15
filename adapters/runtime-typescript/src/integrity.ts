import { createHash } from "node:crypto";

import { SHA256_INTEGRITY_PREFIX } from "@osva/contracts";

export function sha256IntegrityOf(content: Buffer | string): string {
  return `${SHA256_INTEGRITY_PREFIX}${createHash("sha256")
    .update(content)
    .digest("hex")}`;
}

export function integrityMatches(expected: string, actual: string): boolean {
  return expected.toLowerCase() === actual.toLowerCase();
}
