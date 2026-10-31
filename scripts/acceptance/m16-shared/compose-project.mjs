import { createHash } from "node:crypto";
import path from "node:path";

/** Matches `packages/cli/src/setup/compose-project.ts` for acceptance fixtures. */
export function deriveComposeProjectName(installDir) {
  const normalized = path.resolve(installDir).replace(/\\/g, "/").toLowerCase();
  const digest = createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 12);
  return `osva-${digest}`;
}
