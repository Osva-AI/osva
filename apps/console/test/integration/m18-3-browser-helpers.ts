import { mkdirSync } from "node:fs";
import path from "node:path";

import type { Page } from "playwright";

export {
  readHorizontalOverflow,
  seedShellStorage,
  startConsolePreviewServer,
} from "./m18-2-browser-helpers.js";

const consoleRoot = path.resolve(process.cwd());

export const M18_3_EVIDENCE_DIR = path.join(
  consoleRoot,
  "artifacts",
  "m18-3-browser",
);

export function ensureM183EvidenceDir(): void {
  mkdirSync(M18_3_EVIDENCE_DIR, { recursive: true });
}

export async function screenshotPage(
  page: Page,
  fileName: string,
): Promise<string> {
  ensureM183EvidenceDir();
  const filePath = path.join(M18_3_EVIDENCE_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

export async function waitForHome(page: Page): Promise<void> {
  await page.getByRole("heading", { name: "Home", level: 1 }).waitFor({
    timeout: 30_000,
  });
}

export async function waitForExamples(page: Page): Promise<void> {
  await page.getByRole("heading", { name: "Examples", level: 1 }).waitFor({
    timeout: 30_000,
  });
}

export {
  routeEmptyWorkspace,
  routeActiveWorkspace,
} from "./m18-2-browser-helpers.js";
