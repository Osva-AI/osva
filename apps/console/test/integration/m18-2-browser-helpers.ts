import { mkdirSync } from "node:fs";
import path from "node:path";

import type { Page } from "playwright";

import {
  installMockConsoleApi,
  readHorizontalOverflow,
  seedShellStorage,
  startConsolePreviewServer,
} from "./m18-1a-browser-helpers.js";

const consoleRoot = path.resolve(process.cwd());

export const M18_2_EVIDENCE_DIR = path.join(
  consoleRoot,
  "artifacts",
  "m18-2-browser",
);

export function ensureM182EvidenceDir(): void {
  mkdirSync(M18_2_EVIDENCE_DIR, { recursive: true });
}

export async function screenshotHome(
  page: Page,
  fileName: string,
): Promise<string> {
  ensureM182EvidenceDir();
  const filePath = path.join(M18_2_EVIDENCE_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

export async function waitForHome(page: Page): Promise<void> {
  await page.getByRole("heading", { name: "Home", level: 1 }).waitFor({
    timeout: 30_000,
  });
}

export async function routeEmptyWorkspace(page: Page): Promise<void> {
  await installMockConsoleApi(page);
}

export async function routeActiveWorkspace(page: Page): Promise<void> {
  await installMockConsoleApi(page);
  await page.route("**/api/v1/agents", async (route) => {
    if (route.request().url().includes("/versions")) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agents: [
          {
            id: "agent-active-1",
            workspaceId: "ws-admin",
            key: "support",
            name: "Support Agent",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });
  await page.route(/\/api\/v1\/agents\/[^/]+\/versions$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ versions: [] }),
    });
  });
  await page.route("**/api/v1/workflows", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workflows: [
          {
            id: "wf-1",
            workspaceId: "ws-admin",
            key: "triage",
            name: "Triage Flow",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });
  await page.route("**/api/v1/runs**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runs: [
          {
            id: "run-active-1",
            agentId: "agent-active-1",
            status: "RUNNING",
            effectiveBindings: {
              agentVersionId: "av-1",
              modelProfileVersionBindings: {},
              toolVersionBindings: {},
            },
            input: {},
            createdAt: "2026-02-01T00:00:00.000Z",
            updatedAt: "2026-02-01T00:00:01.000Z",
          },
        ],
      }),
    });
  });
}

export async function routeDegradedWorkspace(page: Page): Promise<void> {
  await installMockConsoleApi(page);
  await page.route("**/api/v1/runs**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "runs unavailable" }),
    });
  });
}

export { readHorizontalOverflow, seedShellStorage, startConsolePreviewServer };
