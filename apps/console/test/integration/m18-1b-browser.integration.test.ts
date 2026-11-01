import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  installMockConsoleApi,
  readHorizontalOverflow,
  seedShellStorage,
  startConsolePreviewServer,
} from "./m18-1a-browser-helpers.js";
import { mkdirSync } from "node:fs";
import path from "node:path";

const EVIDENCE_DIR = path.join(process.cwd(), "artifacts", "m18-1b-browser");

async function capture(fileName: string, page: import("playwright").Page) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const filePath = path.join(EVIDENCE_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: false });
  return filePath;
}

describe("M18.1B browser acceptance (UI foundations)", () => {
  let origin = "";
  let stopServer: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const server = await startConsolePreviewServer();
    origin = server.origin;
    stopServer = server.stop;
  }, 120_000);

  afterAll(async () => {
    await stopServer?.();
  });

  it("captures representative UI surfaces in light and dark themes", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await installMockConsoleApi(page);
      await seedShellStorage(page, { theme: "light" });

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${origin}/agents`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Agents", level: 1 }).waitFor();
      await capture("desktop-light-agents-table.png", page);

      await page.getByLabel("Theme preference").selectOption("dark");
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "dark",
      );
      await capture("desktop-dark-agents-table.png", page);

      await page.goto(`${origin}/models/connections`, {
        waitUntil: "networkidle",
      });
      await page
        .getByRole("heading", { name: "Provider connections", level: 1 })
        .waitFor();
      await capture("desktop-dark-model-connection-form.png", page);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${origin}/testing`, { waitUntil: "networkidle" });
      await page
        .getByRole("heading", { name: "Testing Studio", level: 1 })
        .waitFor();
      await capture("mobile-testing-studio.png", page);

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${origin}/workspace/access`, {
        waitUntil: "networkidle",
      });
      await page
        .getByRole("heading", { name: "Workspace access", level: 1 })
        .waitFor();
      await page.getByRole("button", { name: "Remove" }).first().click();
      await page.getByRole("dialog").waitFor();
      await capture("desktop-dark-remove-member-dialog.png", page);

      const overflow = await readHorizontalOverflow(page);
      expect(overflow.docScrollWidth).toBeLessThanOrEqual(
        overflow.docClientWidth + 1,
      );
    } finally {
      await browser.close();
    }
  }, 180_000);
});
