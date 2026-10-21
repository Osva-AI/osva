import fs from "node:fs/promises";
import path from "node:path";

import { REPO_ROOT } from "./environment.mjs";

const HOOK_PATH = path.join(REPO_ROOT, ".git", "hooks", "pre-push");
const MARKER = "# osva-verify-branch-hook";

function printUsage() {
  console.log(`Usage: node scripts/verification/install-pre-push-hook.mjs <enable|disable|status>

Optional Git pre-push hook that runs \`pnpm verify:branch\`.
Disabled by default; never installed by package postinstall.
Does not overwrite an existing hook unless it already carries the OSVA marker.
`);
}

/**
 * @param {"enable" | "disable"} mode
 */
async function main(mode) {
  const hookBody = `#!/bin/sh
${MARKER}
set -e
pnpm verify:branch
`;

  if (mode === "disable") {
    try {
      const existing = await fs.readFile(HOOK_PATH, "utf8");
      if (!existing.includes(MARKER)) {
        console.log(
          "No OSVA verify:branch hook installed (foreign pre-push hook preserved).",
        );
        return;
      }
      await fs.unlink(HOOK_PATH);
      console.log("Removed OSVA verify:branch pre-push hook.");
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        console.log("No pre-push hook present.");
        return;
      }
      throw error;
    }
    return;
  }

  try {
    const existing = await fs.readFile(HOOK_PATH, "utf8");
    if (existing.includes(MARKER)) {
      await fs.writeFile(HOOK_PATH, hookBody, "utf8");
      console.log("Updated OSVA verify:branch pre-push hook.");
      return;
    }
    console.error(
      "Refusing to overwrite an existing pre-push hook.\nRemove it manually or add the OSVA marker, then re-run enable.",
    );
    process.exit(1);
  } catch (error) {
    if (!(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )) {
      throw error;
    }
  }

  await fs.mkdir(path.dirname(HOOK_PATH), { recursive: true });
  await fs.writeFile(HOOK_PATH, hookBody, "utf8");
  if (process.platform !== "win32") {
    await fs.chmod(HOOK_PATH, 0o755);
  }
  console.log("Installed OSVA verify:branch pre-push hook.");
  console.log(
    "Disable with: node scripts/verification/install-pre-push-hook.mjs disable",
  );
}

const mode = process.argv[2];
if (!mode || mode === "--help" || mode === "-h") {
  printUsage();
  process.exit(mode ? 0 : 1);
}

if (mode === "status") {
  try {
    const existing = await fs.readFile(HOOK_PATH, "utf8");
    console.log(
      existing.includes(MARKER)
        ? "OSVA verify:branch pre-push hook: enabled"
        : "pre-push hook: present (not OSVA-managed)",
    );
  } catch {
    console.log("OSVA verify:branch pre-push hook: disabled");
  }
  process.exit(0);
}

if (mode !== "enable" && mode !== "disable") {
  printUsage();
  process.exit(1);
}

main(mode).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
