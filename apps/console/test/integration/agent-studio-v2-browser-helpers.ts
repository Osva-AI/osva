import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import type { Page } from "playwright";
import { expect } from "vitest";
import type { Locator } from "playwright";

import {
  installMockConsoleApi,
  readHorizontalOverflow,
  seedShellStorage,
} from "./m18-1a-browser-helpers.js";

export const AGENT_STUDIO_V2_EVIDENCE_DIR = path.join(
  path.resolve(process.cwd()),
  "artifacts",
  "agent-studio-v2-browser",
);

export function resetAgentStudioV2EvidenceDir(): void {
  rmSync(AGENT_STUDIO_V2_EVIDENCE_DIR, { recursive: true, force: true });
  mkdirSync(AGENT_STUDIO_V2_EVIDENCE_DIR, { recursive: true });
}

export async function setBrowserTheme(
  page: Page,
  theme: "light" | "dark",
): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.dataset.theme = value;
  }, theme);
}

export async function assertStudioStage(
  page: Page,
  stage: "describe" | "equip" | "review" | "test",
): Promise<void> {
  const headings: Record<typeof stage, RegExp> = {
    describe: /What should your agent do\?/,
    equip: /What will your agent need\?/,
    review: /Review your agent/,
    test: /Test your agent/,
  };
  await waitVisible(page.getByRole("heading", { name: headings[stage] }));
  if (stage !== "test") {
    await waitVisible(page.getByTestId(`agent-studio-stage-${stage}`));
  } else {
    await waitVisible(page.getByTestId("agent-studio-test-stage"));
  }
}

async function clickProgressStage(
  page: Page,
  stageTitle: "Describe" | "Equip" | "Review",
): Promise<void> {
  const desktop = page.getByRole("button", { name: `1 ${stageTitle}` });
  if ((await desktop.count()) > 0 && (await desktop.isVisible())) {
    await desktop.click();
    return;
  }
  const mobileExpand = page.locator(
    ".agent-studio-v2-progress-mobile-expand summary",
  );
  if ((await mobileExpand.count()) > 0) {
    await mobileExpand.click();
    await page.getByRole("button", { name: stageTitle, exact: true }).click();
  }
}

/** Agent Studio V2: enable optional Knowledge and Memory on Equip (real or mocked Console). */
export async function openAgentStudioKnowledgeAndMemoryBindings(
  page: Page,
): Promise<void> {
  await page.getByTestId("agent-studio-v2").waitFor({ timeout: 30_000 });
  await goToStudioStage(page, "equip");
  await page.getByRole("button", { name: "Add knowledge" }).click();
  await waitVisible(page.getByRole("heading", { name: "Knowledge bindings" }));
  await page.getByRole("button", { name: "Add memory" }).click();
  await waitVisible(page.getByRole("heading", { name: "Memory bindings" }));
}

export async function goToStudioStage(
  page: Page,
  stage: "describe" | "equip" | "review",
): Promise<void> {
  if (stage === "describe") {
    const describeHeading = page.getByRole("heading", {
      name: /What should your agent do\?/,
    });
    if (!(await describeHeading.isVisible())) {
      await clickProgressStage(page, "Describe");
    }
    await assertStudioStage(page, "describe");
    return;
  }
  if (stage === "equip") {
    await goToStudioStage(page, "describe");
    const name = page.locator("#create-agent-name");
    if ((await name.inputValue()).trim().length === 0) {
      await name.fill("Browser acceptance agent");
    }
    const instructions = page.locator("#studio-instructions");
    if ((await instructions.inputValue()).trim().length === 0) {
      await instructions.fill("Answer product questions clearly.");
    }
    await page
      .getByRole("button", { name: "Continue to capabilities" })
      .click();
    await assertStudioStage(page, "equip");
    return;
  }
  await goToStudioStage(page, "equip");
  await page.getByRole("button", { name: "Continue to review" }).click();
  await assertStudioStage(page, "review");
}

export async function captureStudioViewport(
  page: Page,
  fileName: string,
  expectedWidth: number,
): Promise<{
  readonly path: string;
  readonly width: number;
  readonly height: number;
}> {
  mkdirSync(AGENT_STUDIO_V2_EVIDENCE_DIR, { recursive: true });
  const filePath = path.join(AGENT_STUDIO_V2_EVIDENCE_DIR, fileName);
  await page.evaluate(() => window.scrollTo(0, 0));
  const overflow = await readHorizontalOverflow(page);
  expect(overflow.docScrollWidth).toBeLessThanOrEqual(
    overflow.docClientWidth + 2,
  );
  await page.screenshot({ path: filePath, fullPage: false });
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  expect(dimensions.width).toBe(expectedWidth);
  const pngSize = await readPngDimensions(filePath);
  expect(pngSize.width).toBe(expectedWidth);
  return { path: filePath, width: pngSize.width, height: pngSize.height };
}

async function readPngDimensions(
  filePath: string,
): Promise<{ readonly width: number; readonly height: number }> {
  const { readFileSync } = await import("node:fs");
  const buffer = readFileSync(filePath);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export async function routeAgentStudioV2Admin(
  page: Page,
  options: {
    readonly includeModels?: boolean;
    readonly includeTools?: boolean;
    readonly includeKnowledge?: boolean;
    readonly includeMemory?: boolean;
  } = {},
): Promise<void> {
  const includeModels = options.includeModels ?? true;
  const includeTools = options.includeTools ?? false;
  const includeKnowledge = options.includeKnowledge ?? false;
  const includeMemory = options.includeMemory ?? false;

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
        modelProfiles: includeModels
          ? [
              {
                id: "mp-browser",
                workspaceId: "ws-admin",
                key: "support",
                name: "Support Model",
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ]
          : [],
      }),
    });
  });

  await page.route(
    "**/api/v1/model-profiles/mp-browser/versions",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          versions: includeModels
            ? [
                {
                  id: "mpv-browser-1",
                  modelProfileId: "mp-browser",
                  version: 1,
                  provider: "OPENAI",
                  model: "gpt-test",
                  modelProviderConnectionVersionId: "connv-1",
                  createdAt: "2026-01-01T00:00:00.000Z",
                },
              ]
            : [],
        }),
      });
    },
  );

  await page.route(
    "**/api/v1/model-profiles/*/binding-readiness",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profileVersions: includeModels
            ? [
                {
                  profileId: "mp-browser",
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
                },
              ]
            : [],
        }),
      });
    },
  );

  await page.route("**/api/v1/tools**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        tools: includeTools
          ? [
              {
                id: "tool-1",
                workspaceId: "ws-admin",
                key: "search",
                name: "Search",
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ]
          : [],
      }),
    });
  });

  await page.route("**/api/v1/knowledge/indexes**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        indexes: includeKnowledge
          ? [
              {
                source: {
                  id: "ks-1",
                  name: "Docs",
                  key: "docs",
                  workspaceId: "ws-admin",
                  createdAt: "2026-01-01T00:00:00.000Z",
                },
                index: {
                  id: "ki-1",
                  knowledgeSourceId: "ks-1",
                  status: "READY",
                  createdAt: "2026-01-01T00:00:00.000Z",
                },
              },
            ]
          : [],
      }),
    });
  });

  await page.route("**/api/v1/memory/namespaces**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: includeMemory
          ? [
              {
                id: "mem-1",
                workspaceId: "ws-admin",
                key: "session",
                name: "Session memory",
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ]
          : [],
      }),
    });
  });
}

export async function routeAgentStudioViewer(page: Page): Promise<void> {
  await routeAgentStudioV2Admin(page, { includeModels: true });
  await installMockConsoleApi(page, {
    workspaces: [
      { workspaceId: "ws-admin", name: "Acme Admin", role: "VIEWER" },
    ],
  });
}

export function listEvidenceFiles(): readonly string[] {
  try {
    return readdirSync(AGENT_STUDIO_V2_EVIDENCE_DIR);
  } catch {
    return [];
  }
}

const STUDIO_RUN_AGENT_ID = "agent-partial-browser";
const STUDIO_RUN_VERSION_ID = "av-browser-1";

export async function routeAgentStudioRunDetail(
  page: Page,
  runId: string,
  options: {
    readonly runStatus: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
    readonly attemptStatus?: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  },
): Promise<void> {
  const attemptId = `${runId}-attempt-1`;
  const attemptStatus =
    options.attemptStatus ??
    (options.runStatus === "QUEUED"
      ? "PENDING"
      : options.runStatus === "RUNNING"
        ? "RUNNING"
        : options.runStatus);

  const runBody = {
    id: runId,
    agentId: STUDIO_RUN_AGENT_ID,
    status: options.runStatus,
    effectiveBindings: {
      agentVersionId: STUDIO_RUN_VERSION_ID,
      modelProfileVersionBindings: {},
      toolVersionBindings: {},
    },
    input: { task: "Sample task from Agent Studio test handoff." },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  const attemptBody = {
    id: attemptId,
    runId,
    sequence: 1,
    status: attemptStatus,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt:
      attemptStatus === "PENDING" ? undefined : "2026-01-01T00:00:00.100Z",
    completedAt:
      attemptStatus === "SUCCEEDED" || attemptStatus === "FAILED"
        ? "2026-01-01T00:00:01.000Z"
        : undefined,
    output: attemptStatus === "SUCCEEDED" ? { ok: true } : undefined,
    error:
      attemptStatus === "FAILED"
        ? {
            code: "RUN_FAILED",
            message: "Model invocation failed in browser fixture.",
          }
        : undefined,
    execution:
      attemptStatus === "RUNNING"
        ? {
            state: "running",
            leased: true,
            executionGeneration: 1,
            interrupted: false,
            observedAt: "2026-01-01T00:00:00.500Z",
          }
        : attemptStatus === "SUCCEEDED"
          ? {
              state: "completed",
              leased: false,
              executionGeneration: 1,
              interrupted: false,
              observedAt: "2026-01-01T00:00:01.000Z",
            }
          : undefined,
  };

  await page.route(`**/api/v1/runs/${runId}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(runBody),
    });
  });

  await page.route(`**/api/v1/runs/${runId}/attempts`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        attempts: [
          {
            id: attemptId,
            runId,
            sequence: 1,
            status: attemptStatus,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });

  await page.route(
    `**/api/v1/runs/${runId}/attempts/${attemptId}`,
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(attemptBody),
      });
    },
  );

  await page.route(
    `**/api/v1/runs/${runId}/attempts/${attemptId}/steps`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ steps: [] }),
      });
    },
  );

  await page.route(
    `**/api/v1/runs/${runId}/attempts/${attemptId}/usage`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          modelCalls: 0,
          toolCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedInputTokens: 0,
          estimatedCostUsdMicros: null,
          pricedModelCalls: 0,
          unpricedModelCalls: 0,
        }),
      });
    },
  );

  await page.route("**/api/v1/artifacts?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });
}

export async function assertRunDetailLoaded(page: Page): Promise<void> {
  await waitVisible(
    page.getByRole("heading", { name: "Agent run", exact: true }),
  );
  await waitVisible(page.getByTestId("run-detail-v2"));
}

export async function assertReviewBlockersFixture(page: Page): Promise<void> {
  await waitVisible(page.getByTestId("agent-studio-review-blockers"));
  await waitVisible(
    page.getByText(/Choose an AI model version before publishing/i),
  );
  expect(
    await page.getByTestId("agent-studio-publish-button").isDisabled(),
  ).toBe(true);
}

export async function assertStudioTestHandoffFitsViewport(
  page: Page,
): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const width = viewport?.width ?? 0;
  const runTest = page.getByRole("button", { name: "Run test" });
  await waitVisible(runTest);
  const runBox = await runTest.boundingBox();
  expect(runBox).not.toBeNull();
  if (runBox !== null) {
    expect(runBox.x).toBeGreaterThanOrEqual(0);
    expect(runBox.x + runBox.width).toBeLessThanOrEqual(width + 1);
  }
  const launch = page.getByTestId("agent-studio-run-launch");
  if ((await launch.count()) > 0) {
    const launchBox = await launch.boundingBox();
    expect(launchBox).not.toBeNull();
    if (launchBox !== null) {
      expect(launchBox.x).toBeGreaterThanOrEqual(0);
      expect(launchBox.x + launchBox.width).toBeLessThanOrEqual(width + 1);
    }
  }
}

export async function assertViewerStudioReadOnly(page: Page): Promise<void> {
  await waitVisible(page.getByText(/Read-only workspace access/i));
  expect(await page.locator("#create-agent-name").isDisabled()).toBe(true);
  expect(await page.locator("#studio-instructions").isDisabled()).toBe(true);
  expect(await page.getByTestId("agent-studio-publish-button").count()).toBe(0);
}

async function waitVisible(locator: Locator): Promise<void> {
  await locator.waitFor({ state: "visible", timeout: 15_000 });
}

export async function clearAgentStudioCreateDraftInPage(
  page: Page,
): Promise<void> {
  await page.evaluate(() => {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith("osva.console.agent-studio-create")) {
        sessionStorage.removeItem(key);
      }
    }
  });
}

export async function seedAgentStudioBrowserContext(
  page: Page,
  options: { readonly workspaceId: string; readonly theme?: "light" | "dark" },
): Promise<void> {
  await page.addInitScript(() => {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith("osva.console.agent-studio-create")) {
        sessionStorage.removeItem(key);
      }
    }
  });
  await seedShellStorage(page, options);
}

export { readHorizontalOverflow, seedShellStorage };
