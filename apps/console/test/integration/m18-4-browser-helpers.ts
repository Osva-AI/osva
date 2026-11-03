import { mkdirSync } from "node:fs";
import path from "node:path";

import type { Page } from "playwright";

import {
  installMockConsoleApi,
  readHorizontalOverflow,
  seedShellStorage,
  startConsolePreviewServer,
  type MockWorkspace,
} from "./m18-1a-browser-helpers.js";

export { readHorizontalOverflow, seedShellStorage, startConsolePreviewServer };

const consoleRoot = path.resolve(process.cwd());

export const M18_4_EVIDENCE_DIR = path.join(
  consoleRoot,
  "artifacts",
  "m18-4-browser",
);

export function ensureM184EvidenceDir(): void {
  mkdirSync(M18_4_EVIDENCE_DIR, { recursive: true });
}

export async function screenshotOnboarding(
  page: Page,
  fileName: string,
): Promise<string> {
  ensureM184EvidenceDir();
  const filePath = path.join(M18_4_EVIDENCE_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

export async function waitForOnboarding(page: Page): Promise<void> {
  await page
    .getByRole("heading", { name: "Get your first agent running", level: 1 })
    .waitFor({ timeout: 30_000 });
}

const DECLARATIVE_MANIFEST = {
  runtime: { type: "DECLARATIVE" },
  capabilities: { model: true, tools: [] },
};

export async function routeOnboardingEmptyWorkspace(page: Page): Promise<void> {
  await installMockConsoleApi(page);
}

export async function routeOnboardingConfiguredWorkspace(
  page: Page,
  options: {
    readonly runStatus?: string;
    readonly role?: string;
    readonly includePublishedVersion?: boolean;
    readonly includeAgents?: boolean;
    readonly includeRuns?: boolean;
  } = {},
): Promise<void> {
  const runStatus = options.runStatus;
  const includePublishedVersion = options.includePublishedVersion ?? true;
  const includeAgents = options.includeAgents ?? true;
  const includeRuns = options.includeRuns ?? options.runStatus !== undefined;
  const effectiveRunStatus = runStatus ?? "QUEUED";
  const workspaces: readonly MockWorkspace[] = [
    {
      workspaceId: "ws-admin",
      name: "Acme Admin",
      role: options.role ?? "ADMIN",
    },
  ];
  await installMockConsoleApi(page, { workspaces });

  await page.route("**/api/v1/model-provider-connections", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        connections: [
          {
            id: "conn-1",
            workspaceId: "ws-admin",
            key: "openai",
            name: "OpenAI",
            provider: "OPENAI",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });

  await page.route("**/api/v1/model-profiles", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        modelProfiles: [
          {
            id: "mp-1",
            workspaceId: "ws-admin",
            key: "primary",
            name: "Primary",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });

  await page.route(
    /\/api\/v1\/model-profiles\/[^/]+\/versions$/,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          versions: [
            {
              id: "mpv-1",
              modelProfileId: "mp-1",
              version: 1,
              provider: "OPENAI",
              model: "gpt-test",
              modelProviderConnectionVersionId: "conn-v-1",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        }),
      });
    },
  );

  await page.route("**/api/v1/agents", async (route) => {
    if (route.request().url().includes("/versions")) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agents: includeAgents
          ? [
              {
                id: "agent-onb-1",
                workspaceId: "ws-admin",
                key: "demo",
                name: "Demo Agent",
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ]
          : [],
      }),
    });
  });

  const publishedVersion = {
    id: "av-onb-1",
    agentId: "agent-onb-1",
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    manifest: DECLARATIVE_MANIFEST,
  };

  await page.route(/\/api\/v1\/agents\/[^/]+\/versions$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        versions: includePublishedVersion ? [publishedVersion] : [],
      }),
    });
  });

  await page.route(
    /\/api\/v1\/agents\/agent-onb-1\/versions\/av-onb-1$/,
    async (route) => {
      if (!includePublishedVersion) {
        await route.fulfill({ status: 404, body: "Not found" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(publishedVersion),
      });
    },
  );

  await page.route("**/api/v1/runs**", async (route) => {
    const url = route.request().url();
    const runResource = {
      id: "run-onb-1",
      agentId: "agent-onb-1",
      status: effectiveRunStatus,
      effectiveBindings: {
        agentVersionId: "av-onb-1",
        modelProfileVersionBindings: {},
        toolVersionBindings: {},
      },
      input: { task: "hello" },
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:01.000Z",
    };
    if (!includeRuns || !includePublishedVersion) {
      if (url.match(/\/runs\/run-onb-1$/)) {
        await route.fulfill({ status: 404, body: "Not found" });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ runs: [] }),
      });
      return;
    }
    if (url.match(/\/runs\/run-onb-1$/)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(runResource),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runs: [runResource],
      }),
    });
  });
}

export async function openOnboarding(
  page: Page,
  origin: string,
  options: {
    readonly theme?: "light" | "dark";
    readonly query?: string;
    readonly workspaceId?: string;
  } = {},
): Promise<void> {
  await seedShellStorage(page, {
    workspaceId: options.workspaceId ?? "ws-admin",
    theme: options.theme ?? "light",
    sidebarCollapsed: false,
  });
  const query = options.query ?? "";
  await page.goto(`${origin}/onboarding${query}`, {
    waitUntil: "networkidle",
  });
  await waitForOnboarding(page);
}
