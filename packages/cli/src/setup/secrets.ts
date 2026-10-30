import { randomBytes } from "node:crypto";

export function generateSecretHex(byteLength: number): string {
  if (!Number.isInteger(byteLength) || byteLength < 16) {
    throw new Error("Secret byte length must be at least 16.");
  }
  return randomBytes(byteLength).toString("hex");
}
