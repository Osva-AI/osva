import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect } from "vitest";
import type { Page } from "playwright";

import { readHorizontalOverflow } from "./m18-1a-browser-helpers.js";

export const UX_V23_ONBOARDING_EVIDENCE_DIR = path.join(
  path.resolve(process.cwd()),
  "artifacts",
  "ux-v2-onboarding-browser",
);

export function ensureUxV23EvidenceDir(): void {
  mkdirSync(UX_V23_ONBOARDING_EVIDENCE_DIR, { recursive: true });
}

export function readPngWidth(filePath: string): number {
  const buffer = readFileSync(filePath);
  return buffer.readUInt32BE(16);
}

export async function captureOnboardingEvidence(
  page: Page,
  fileName: string,
  options: {
    readonly expectedViewportWidth: number;
    readonly assertState: () => Promise<void>;
    readonly beforeCapture?: () => Promise<void>;
  },
): Promise<string> {
  const viewport = page.viewportSize();
  expect(viewport?.width).toBe(options.expectedViewportWidth);

  await options.assertState();

  if (options.beforeCapture !== undefined) {
    await options.beforeCapture();
  }

  const overflow = await readHorizontalOverflow(page);
  expect(overflow.docScrollWidth).toBeLessThanOrEqual(
    overflow.docClientWidth + 1,
  );

  ensureUxV23EvidenceDir();
  const filePath = path.join(UX_V23_ONBOARDING_EVIDENCE_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: false });
  expect(readPngWidth(filePath)).toBe(options.expectedViewportWidth);
  return filePath;
}
