import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startConsolePreviewServer } from "./m18-5-browser-helpers.js";
import {
  assertReviewBlockersFixture,
  assertStudioStage,
  assertStudioTestHandoffFitsViewport,
  assertViewerStudioReadOnly,
  captureStudioViewport,
  goToStudioStage,
  resetAgentStudioV2EvidenceDir,
  routeAgentStudioV2Admin,
  routeAgentStudioRunDetail,
  routeAgentStudioViewer,
  assertRunDetailLoaded,
  clearAgentStudioCreateDraftInPage,
  seedAgentStudioBrowserContext,
  setBrowserTheme,
} from "./agent-studio-v2-browser-helpers.js";

describe("Agent Studio V2 browser acceptance", () => {
  let origin = "";
  let stopServer: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    resetAgentStudioV2EvidenceDir();
    const server = await startConsolePreviewServer();
    origin = server.origin;
    stopServer = server.stop;
  }, 120_000);

  afterAll(async () => {
    await stopServer?.();
  });

  it("captures desktop describe, equip, review, and theme states with correct viewport", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await routeAgentStudioV2Admin(page, { includeModels: false });
      await seedAgentStudioBrowserContext(page, {
        workspaceId: "ws-admin",
        theme: "light",
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${origin}/agents/new`, { waitUntil: "networkidle" });
      await page.getByTestId("agent-studio-v2").waitFor({ timeout: 30_000 });
      await assertStudioStage(page, "describe");
      await captureStudioViewport(
        page,
        "desktop-1440-describe-empty-light.png",
        1440,
      );

      await page.fill("#create-agent-name", "Support helper");
      await page.fill("#studio-instructions", "Answer billing questions.");
      await page.fill("#studio-examples", "User: Where is my invoice?");
      await assertStudioStage(page, "describe");
      await captureStudioViewport(
        page,
        "desktop-1440-describe-filled-light.png",
        1440,
      );

      await page.getByRole("button", { name: "Templates" }).click();
      await page.getByText("Template ideas").waitFor();
      await captureStudioViewport(
        page,
        "desktop-1440-templates-light.png",
        1440,
      );
      await page.keyboard.press("Escape");

      await goToStudioStage(page, "equip");
      await page.getByTestId("agent-studio-model-empty").waitFor();
      await captureStudioViewport(
        page,
        "desktop-1440-equip-no-model-light.png",
        1440,
      );

      await page.unroute("**/api/v1/model-profiles");
      await routeAgentStudioV2Admin(page, { includeModels: true });
      await page.reload({ waitUntil: "networkidle" });
      await goToStudioStage(page, "equip");
      await page.locator("#agent-model-profile").selectOption("mp-browser");
      await page.locator("#agent-primary-model").selectOption("mpv-browser-1");
      await captureStudioViewport(
        page,
        "desktop-1440-equip-model-selected-light.png",
        1440,
      );

      await page.getByRole("button", { name: "Add tools" }).click();
      await captureStudioViewport(
        page,
        "desktop-1440-equip-tools-empty-light.png",
        1440,
      );
      await page.getByRole("button", { name: "Remove tools" }).click();

      await routeAgentStudioV2Admin(page, {
        includeModels: true,
        includeKnowledge: true,
      });
      await page.reload({ waitUntil: "networkidle" });
      await goToStudioStage(page, "equip");
      await page.getByRole("button", { name: "Add knowledge" }).click();
      await captureStudioViewport(
        page,
        "desktop-1440-equip-knowledge-light.png",
        1440,
      );

      await routeAgentStudioV2Admin(page, {
        includeModels: true,
        includeMemory: true,
      });
      await page.reload({ waitUntil: "networkidle" });
      await goToStudioStage(page, "equip");
      await page.getByRole("button", { name: "Add memory" }).click();
      await captureStudioViewport(
        page,
        "desktop-1440-equip-memory-light.png",
        1440,
      );

      await page.locator("#agent-model-profile").selectOption("mp-browser");
      await page.locator("#agent-primary-model").selectOption("mpv-browser-1");
      await page.getByRole("button", { name: "Continue to review" }).click();
      await assertStudioStage(page, "review");
      await captureStudioViewport(
        page,
        "desktop-1440-review-ready-light.png",
        1440,
      );

      await page.getByRole("button", { name: "Back" }).click();
      await assertStudioStage(page, "equip");
      await page.locator("#agent-primary-model").selectOption("");
      await page.getByRole("button", { name: "Continue to review" }).click();
      await assertStudioStage(page, "review");
      await assertReviewBlockersFixture(page);
      await captureStudioViewport(
        page,
        "desktop-1440-review-blockers-light.png",
        1440,
      );

      await page.getByRole("button", { name: "Back" }).click();
      await page.locator("#agent-model-profile").selectOption("mp-browser");
      await page.locator("#agent-primary-model").selectOption("mpv-browser-1");
      await page.getByRole("button", { name: "Continue to review" }).click();
      await assertStudioStage(page, "review");

      await page.getByRole("button", { name: "Publish agent version" }).click();
      await page.getByRole("dialog").waitFor();
      await captureStudioViewport(
        page,
        "desktop-1440-publish-confirm-light.png",
        1440,
      );
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Advanced JSON" }).first().click();
      await page.getByLabel("AgentVersion manifest").waitFor();
      await captureStudioViewport(
        page,
        "desktop-1440-advanced-json-light.png",
        1440,
      );

      await page.goto(`${origin}/agents/new`, { waitUntil: "networkidle" });
      await assertStudioStage(page, "describe");
      await setBrowserTheme(page, "dark");
      await captureStudioViewport(page, "desktop-1440-describe-dark.png", 1440);

      await goToStudioStage(page, "equip");
      await setBrowserTheme(page, "dark");
      await captureStudioViewport(page, "desktop-1440-equip-dark.png", 1440);

      await goToStudioStage(page, "review");
      await setBrowserTheme(page, "dark");
      await captureStudioViewport(page, "desktop-1440-review-dark.png", 1440);
    } finally {
      await browser.close();
    }
  }, 360_000);

  it("captures mobile, tablet, viewer, invalid JSON, and partial publish states", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await routeAgentStudioV2Admin(page, { includeModels: true });
      await seedAgentStudioBrowserContext(page, {
        workspaceId: "ws-admin",
        theme: "light",
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${origin}/agents/new`, { waitUntil: "networkidle" });
      await assertStudioStage(page, "describe");
      await captureStudioViewport(page, "mobile-390-describe-light.png", 390);

      await page.getByRole("button", { name: "Templates" }).click();
      await captureStudioViewport(page, "mobile-390-templates-light.png", 390);
      await page.keyboard.press("Escape");

      await goToStudioStage(page, "equip");
      await captureStudioViewport(page, "mobile-390-equip-light.png", 390);
      await goToStudioStage(page, "review");
      await captureStudioViewport(page, "mobile-390-review-light.png", 390);

      await page.setViewportSize({ width: 768, height: 1024 });
      await clearAgentStudioCreateDraftInPage(page);
      await page.goto(`${origin}/agents/new`, { waitUntil: "networkidle" });
      await assertStudioStage(page, "describe");
      await captureStudioViewport(page, "tablet-768-describe-light.png", 768);
      await goToStudioStage(page, "equip");
      await captureStudioViewport(page, "tablet-768-equip-light.png", 768);
      await goToStudioStage(page, "review");
      await captureStudioViewport(page, "tablet-768-review-light.png", 768);

      await page.setViewportSize({ width: 1440, height: 900 });
      await clearAgentStudioCreateDraftInPage(page);
      await page.goto(`${origin}/agents/new`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Advanced JSON" }).first().click();
      const json = page.getByLabel("AgentVersion manifest");
      await json.fill("{ invalid");
      await page.getByRole("button", { name: "Guided" }).click();
      await page.getByText(/Manifest JSON is invalid/i).waitFor();
      await captureStudioViewport(
        page,
        "desktop-1440-invalid-json-recovery-light.png",
        1440,
      );

      await routeAgentStudioViewer(page);
      await page.goto(`${origin}/agents/new`, { waitUntil: "networkidle" });
      await assertStudioStage(page, "describe");
      await assertViewerStudioReadOnly(page);
      await captureStudioViewport(
        page,
        "desktop-1440-viewer-readonly-light.png",
        1440,
      );

      await routeAgentStudioV2Admin(page, { includeModels: true });
      await clearAgentStudioCreateDraftInPage(page);
      await page.goto(`${origin}/agents/new`, { waitUntil: "networkidle" });

      let versionPosts = 0;
      await page.route("**/api/v1/agents", async (route) => {
        if (route.request().method() === "POST") {
          await route.fulfill({
            status: 201,
            contentType: "application/json",
            body: JSON.stringify({
              id: "agent-partial-browser",
              workspaceId: "ws-admin",
              key: "partial",
              name: "Partial",
              createdAt: "2026-01-01T00:00:00.000Z",
            }),
          });
          return;
        }
        await route.continue();
      });
      await page.route(
        "**/api/v1/agents/agent-partial-browser/versions",
        async (route) => {
          if (route.request().method() === "POST") {
            versionPosts += 1;
            if (versionPosts === 1) {
              await route.fulfill({ status: 500, body: "fail" });
              return;
            }
            await route.fulfill({
              status: 201,
              contentType: "application/json",
              body: JSON.stringify({
                id: "av-browser-1",
                agentId: "agent-partial-browser",
                version: 1,
                createdAt: "2026-01-01T00:00:00.000Z",
              }),
            });
            return;
          }
          await route.continue();
        },
      );

      await page.fill("#create-agent-name", "Partial agent");
      await page.fill("#studio-instructions", "Recover from partial publish.");
      await goToStudioStage(page, "equip");
      await page.locator("#agent-model-profile").selectOption("mp-browser");
      await page.locator("#agent-primary-model").selectOption("mpv-browser-1");
      await goToStudioStage(page, "review");
      await page.getByRole("button", { name: "Publish agent version" }).click();
      await page.locator('[data-confirm-dialog="confirm"]').click();
      await page
        .getByText(/Agent created, but publishing didn.t finish/i)
        .waitFor({
          timeout: 20_000,
        });
      await captureStudioViewport(
        page,
        "desktop-1440-partial-publish-light.png",
        1440,
      );

      const partialManifest = {
        schemaVersion: "1",
        key: "partial",
        name: "Partial agent",
        runtime: {
          type: "DECLARATIVE",
          config: {
            configVersion: "1",
            instructions: "Recover from partial publish.",
            modelBinding: "primary",
            allowedToolBindings: [],
            maxModelInvocations: 8,
            maxToolInvocations: 0,
          },
        },
        models: { primary: { modelProfileVersionId: "mpv-browser-1" } },
        input: { schema: { type: "object" } },
        output: { schema: { type: "object" } },
        execution: { timeoutMs: 120_000, maxAttempts: 1 },
        capabilities: { model: true, tools: [] },
      };
      await page.route(
        "**/api/v1/agents/agent-partial-browser",
        async (route) => {
          if (route.request().method() === "GET") {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                id: "agent-partial-browser",
                workspaceId: "ws-admin",
                key: "partial",
                name: "Partial agent",
                createdAt: "2026-01-01T00:00:00.000Z",
              }),
            });
            return;
          }
          await route.continue();
        },
      );
      await page.route(
        "**/api/v1/agents/agent-partial-browser/versions/av-browser-1",
        async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              id: "av-browser-1",
              agentId: "agent-partial-browser",
              version: 1,
              createdAt: "2026-01-01T00:00:00.000Z",
              manifest: partialManifest,
            }),
          });
        },
      );

      await page.getByRole("button", { name: "Retry publishing" }).click();
      await page.locator('[data-confirm-dialog="confirm"]').click();
      await page.getByTestId("agent-studio-test-stage").waitFor({
        timeout: 30_000,
      });
      await assertStudioStage(page, "test");
      await captureStudioViewport(
        page,
        "desktop-1440-test-handoff-light.png",
        1440,
      );
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await assertStudioTestHandoffFitsViewport(page);
      await captureStudioViewport(
        page,
        "tablet-768-test-handoff-light.png",
        768,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await assertStudioTestHandoffFitsViewport(page);
      await captureStudioViewport(
        page,
        "mobile-390-test-handoff-light.png",
        390,
      );

      expect(versionPosts).toBe(2);
    } finally {
      await browser.close();
    }
  }, 360_000);

  it("captures run lifecycle states after Agent Studio test handoff", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await routeAgentStudioV2Admin(page, { includeModels: true });
      await seedAgentStudioBrowserContext(page, {
        workspaceId: "ws-admin",
        theme: "light",
      });
      await page.setViewportSize({ width: 1440, height: 900 });

      const handoffQuery =
        "from=onboarding&agentId=agent-partial-browser&agentVersionId=av-browser-1";

      const scenarios = [
        {
          runId: "run-studio-queued",
          runStatus: "QUEUED" as const,
          file: "desktop-1440-run-queued-light.png",
          waitFor: /Queued for execution/i,
        },
        {
          runId: "run-studio-running",
          runStatus: "RUNNING" as const,
          file: "desktop-1440-run-running-light.png",
          waitFor: /Execution in progress/i,
        },
        {
          runId: "run-studio-succeeded",
          runStatus: "SUCCEEDED" as const,
          file: "desktop-1440-run-succeeded-light.png",
          waitFor: /Output/i,
        },
        {
          runId: "run-studio-failed",
          runStatus: "FAILED" as const,
          file: "desktop-1440-run-failed-light.png",
          waitFor: "failure-guidance" as const,
        },
      ];

      for (const scenario of scenarios) {
        await routeAgentStudioRunDetail(page, scenario.runId, {
          runStatus: scenario.runStatus,
        });
        await page.goto(`${origin}/runs/${scenario.runId}?${handoffQuery}`, {
          waitUntil: "networkidle",
        });
        await assertRunDetailLoaded(page);
        if (scenario.waitFor === "failure-guidance") {
          await page.getByTestId("run-failure-guidance").waitFor({
            timeout: 15_000,
          });
        } else {
          await page.getByText(scenario.waitFor).first().waitFor({
            timeout: 15_000,
          });
        }
        await captureStudioViewport(page, scenario.file, 1440);
      }
    } finally {
      await browser.close();
    }
  }, 180_000);
});
