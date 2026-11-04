import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import type { Page } from "playwright";

import type { WorkflowBuilderDraft } from "../../src/client/lib/workflow-builder-draft.js";
import { workflowBuilderStorageKey } from "../../src/client/lib/workflow-builder-storage.js";

import {
  installMockConsoleApi,
  readHorizontalOverflow,
  seedShellStorage,
  startConsolePreviewServer,
} from "./m18-1a-browser-helpers.js";

export {
  installMockConsoleApi,
  readHorizontalOverflow,
  seedShellStorage,
  startConsolePreviewServer,
};

export const WORKFLOW_STUDIO_V2_EVIDENCE_DIR = path.join(
  path.resolve(process.cwd()),
  "artifacts",
  "workflow-studio-v2-browser",
);

export function resetWorkflowStudioV2EvidenceDir(): void {
  rmSync(WORKFLOW_STUDIO_V2_EVIDENCE_DIR, { recursive: true, force: true });
  mkdirSync(WORKFLOW_STUDIO_V2_EVIDENCE_DIR, { recursive: true });
}

export async function applyPageTheme(
  page: Page,
  theme: "light" | "dark",
): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
    localStorage.setItem("osva.console.themePreference", value);
  }, theme);
}

export async function assertPageTheme(
  page: Page,
  theme: "light" | "dark",
): Promise<void> {
  const actual = await page.evaluate(
    () => document.documentElement.dataset.theme ?? "light",
  );
  if (actual !== theme) {
    throw new Error(`Expected theme ${theme}, got ${actual}`);
  }
}

export async function screenshotWorkflowStudio(
  page: Page,
  fileName: string,
): Promise<string> {
  mkdirSync(WORKFLOW_STUDIO_V2_EVIDENCE_DIR, { recursive: true });
  const filePath = path.join(WORKFLOW_STUDIO_V2_EVIDENCE_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: false });
  return filePath;
}

export async function routeWorkflowStudioWorkspace(page: Page): Promise<void> {
  await installMockConsoleApi(page, {
    workspaces: [
      { workspaceId: "ws-admin", name: "Acme Admin", role: "ADMIN" },
      { workspaceId: "ws-viewer", name: "Acme Viewer", role: "VIEWER" },
    ],
  });

  await page.route("**/api/v1/agents", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agents: [
          {
            id: "agent-1",
            workspaceId: "ws-admin",
            key: "support",
            name: "Support Agent",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });

  await page.route("**/api/v1/agents/agent-1/versions", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        versions: [
          {
            id: "av-1",
            agentId: "agent-1",
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });

  await page.route("**/api/v1/workflows", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: "wf-browser",
          workspaceId: "ws-admin",
          key: "browser-wf",
          name: "Browser WF",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ workflows: [] }),
    });
  });

  await page.route("**/api/v1/workflows/wf-browser/versions", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: "wv-browser-1",
          workflowId: "wf-browser",
          workspaceId: "ws-admin",
          version: 1,
          definition: { schemaVersion: "3", nodes: [], edges: [] },
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      });
      return;
    }
    await route.continue();
  });
}

export async function openWorkflowCreate(
  page: Page,
  origin: string,
): Promise<void> {
  await page.goto(`${origin}/workflows/new`, { waitUntil: "load" });
  await page.getByTestId("workflow-studio-v2").waitFor({ timeout: 30_000 });
}

export async function fillWorkflowDetails(
  page: Page,
  key: string,
  name: string,
): Promise<void> {
  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByLabel("Registry key").fill(key);
  await page.getByLabel("Name").fill(name);
  await page.getByRole("button", { name: "Done" }).click();
}

export async function seedStoredWorkflowDraft(
  page: Page,
  draft: WorkflowBuilderDraft,
): Promise<void> {
  const storageKey = workflowBuilderStorageKey(draft.workspaceId, draft);
  const envelope = JSON.stringify({ version: 2, draft });
  await page.evaluate(
    ({ key, value }) => {
      sessionStorage.setItem(key, value);
    },
    { key: storageKey, value: envelope },
  );
}

export async function routeWorkflowStudioPartialPublishFailure(
  page: Page,
): Promise<void> {
  let versionCalls = 0;
  await page.route("**/api/v1/workflows/wf-partial/versions", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    versionCalls += 1;
    if (versionCalls === 1) {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        headers: { "x-osva-request-id": "req-fail-browser" },
        body: JSON.stringify({
          error: "Invalid definition.",
          code: "invalid_request",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "wv-partial-1",
        workflowId: "wf-partial",
        workspaceId: "ws-admin",
        version: 1,
        definition: { schemaVersion: "3", nodes: [], edges: [] },
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    });
  });

  await page.route("**/api/v1/workflows", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const url = route.request().url();
    if (!url.endsWith("/api/v1/workflows")) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        id: "wf-partial",
        workspaceId: "ws-admin",
        key: "partial",
        name: "Partial",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    });
  });
}

export async function routePublishedWorkflowVersionPage(
  page: Page,
): Promise<void> {
  await page.route(
    "**/api/v1/workflows/wf-browser/versions/wv-browser-1",
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "wv-browser-1",
          workflowId: "wf-browser",
          workspaceId: "ws-admin",
          version: 1,
          definition: {
            schemaVersion: "3",
            nodes: [
              {
                key: "agent-step-1",
                type: "AGENT",
                agentVersionId: "av-1",
              },
            ],
            edges: [],
          },
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      });
    },
  );

  await page.route("**/api/v1/workflows/wf-browser", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "wf-browser",
        workspaceId: "ws-admin",
        key: "browser-wf",
        name: "Browser WF",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    });
  });
}
