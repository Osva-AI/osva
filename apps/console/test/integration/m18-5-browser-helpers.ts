import { mkdirSync } from "node:fs";
import path from "node:path";

import type { Page } from "playwright";

import {
  installMockConsoleApi,
  readHorizontalOverflow,
  seedShellStorage,
  startConsolePreviewServer,
} from "./m18-1a-browser-helpers.js";

export { readHorizontalOverflow, seedShellStorage, startConsolePreviewServer };

const consoleRoot = path.resolve(process.cwd());

export const M18_5_EVIDENCE_DIR = path.join(
  consoleRoot,
  "artifacts",
  "m18-5-browser",
);

export function ensureM185EvidenceDir(): void {
  mkdirSync(M18_5_EVIDENCE_DIR, { recursive: true });
}

export async function screenshotAgentStudio(
  page: Page,
  fileName: string,
): Promise<string> {
  ensureM185EvidenceDir();
  const filePath = path.join(M18_5_EVIDENCE_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

export async function routeAgentStudioWorkspace(page: Page): Promise<void> {
  await installMockConsoleApi(page, {
    workspaces: [
      { workspaceId: "ws-admin", name: "Acme Admin", role: "ADMIN" },
    ],
  });

  await page.route("**/api/v1/model-profiles", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        modelProfiles: [
          {
            id: "mp-browser",
            workspaceId: "ws-admin",
            key: "support",
            name: "Support Model",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });

  await page.route(
    "**/api/v1/model-profiles/mp-browser/versions",
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          versions: [
            {
              id: "mpv-browser-1",
              modelProfileId: "mp-browser",
              version: 1,
              provider: "OPENAI",
              model: "gpt-test",
              modelProviderConnectionVersionId: "connv-1",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      });
    },
  );

  await page.route("**/api/v1/tools", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tools: [] }),
    });
  });

  await page.route("**/api/v1/knowledge/indexes**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ indexes: [] }),
    });
  });

  await page.route("**/api/v1/memory/namespaces", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ namespaces: [] }),
    });
  });
}

export async function openAgentCreate(
  page: Page,
  origin: string,
): Promise<void> {
  await page.goto(`${origin}/agents/new`, { waitUntil: "networkidle" });
  await page
    .getByRole("heading", { name: "Create Agent", level: 1 })
    .waitFor({ timeout: 30_000 });
}
