import { createHash } from "node:crypto";
import path from "node:path";

/** Stable Compose project identity scoped to the installation directory path. */
export function deriveComposeProjectName(installDir: string): string {
  const normalized = path.resolve(installDir).replace(/\\/g, "/").toLowerCase();
  const digest = createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 12);
  return `osva-${digest}`;
}
