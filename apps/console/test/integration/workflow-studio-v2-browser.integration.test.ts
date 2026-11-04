import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  addAgentNode,
  createEmptyWorkflowBuilderDraft,
  updateRegistry,
} from "../../src/client/lib/workflow-builder-linear.js";

import {
  applyPageTheme,
  assertPageTheme,
  fillWorkflowDetails,
  openWorkflowCreate,
  readHorizontalOverflow,
  resetWorkflowStudioV2EvidenceDir,
  routePublishedWorkflowVersionPage,
  routeWorkflowStudioPartialPublishFailure,
  routeWorkflowStudioWorkspace,
  screenshotWorkflowStudio,
  seedShellStorage,
  seedStoredWorkflowDraft,
  startConsolePreviewServer,
} from "./workflow-studio-v2-browser-helpers.js";

describe("Workflow Studio V2 browser acceptance", () => {
  let origin = "";
  let stopServer: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    resetWorkflowStudioV2EvidenceDir();
    const server = await startConsolePreviewServer();
    origin = server.origin;
    stopServer = server.stop;
  }, 120_000);

  afterAll(async () => {
    await stopServer?.();
  });

  it("captures desktop builder scenarios in light and dark", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await routeWorkflowStudioWorkspace(page);
      await seedShellStorage(page, {
        workspaceId: "ws-admin",
        theme: "light",
      });

      await page.setViewportSize({ width: 1440, height: 900 });
      await openWorkflowCreate(page, origin);
      await assertPageTheme(page, "light");
      await screenshotWorkflowStudio(page, "desktop-1440-blank-light.png");

      await fillWorkflowDetails(page, "browser-wf", "Browser WF");
      await page.getByRole("button", { name: /^Decision\b/ }).click();
      await screenshotWorkflowStudio(page, "desktop-1440-decision-light.png");

      await page.getByRole("button", { name: /^AI agent\b/ }).click();
      await page.getByLabel("Agent", { exact: true }).selectOption("agent-1");
      await page.getByLabel("Agent version (immutable)").selectOption("av-1");
      await screenshotWorkflowStudio(
        page,
        "desktop-1440-agent-selected-light.png",
      );

      await page.getByRole("button", { name: /^Approval\b/ }).click();
      await screenshotWorkflowStudio(
        page,
        "desktop-1440-approval-inspector-light.png",
      );

      await page.getByRole("button", { name: /^Wait\b/ }).click();
      await screenshotWorkflowStudio(page, "desktop-1440-wait-light.png");

      await page.getByRole("button", { name: "Focus mode" }).click();
      await screenshotWorkflowStudio(page, "desktop-1440-focus-mode-light.png");
      await page.getByRole("button", { name: "Exit focus" }).click();

      await page.getByRole("button", { name: "Review and publish" }).click();
      await page.getByTestId("workflow-publish-review").waitFor();
      await screenshotWorkflowStudio(
        page,
        "desktop-1440-publish-ready-light.png",
      );
      await page.getByRole("button", { name: "Back to editor" }).click();

      await applyPageTheme(page, "dark");
      await assertPageTheme(page, "dark");
      await screenshotWorkflowStudio(page, "desktop-1440-canvas-dark.png");
      await page
        .locator("summary", { hasText: "Accessible steps list" })
        .click();
      await page.getByRole("button", { name: /Run AI agent:/i }).click();
      await screenshotWorkflowStudio(page, "desktop-1440-inspector-dark.png");
    } finally {
      await browser.close();
    }
  }, 180_000);

  it("captures tablet and mobile layouts with explicit light theme", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const context = await browser.newContext({
        viewport: { width: 1024, height: 900 },
      });
      let page = await context.newPage();
      await routeWorkflowStudioWorkspace(page);
      await seedShellStorage(page, {
        workspaceId: "ws-admin",
        theme: "light",
      });
      await openWorkflowCreate(page, origin);
      await page.getByRole("button", { name: /^AI agent\b/ }).click();
      await assertPageTheme(page, "light");
      await screenshotWorkflowStudio(page, "tablet-1024-canvas-light.png");

      await context.close();
      const tabletContext = await browser.newContext({
        viewport: { width: 768, height: 1024 },
      });
      page = await tabletContext.newPage();
      await routeWorkflowStudioWorkspace(page);
      await seedShellStorage(page, {
        workspaceId: "ws-admin",
        theme: "light",
      });
      await openWorkflowCreate(page, origin);
      await page.getByRole("button", { name: "Add step" }).click();
      await page.getByRole("button", { name: /^AI agent\b/ }).click();
      await page
        .getByRole("dialog", { name: "Step settings" })
        .waitFor({ timeout: 10_000 });
      await screenshotWorkflowStudio(
        page,
        "tablet-768-inspector-sheet-light.png",
      );
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Review and publish" }).click();
      await page.getByTestId("workflow-publish-review").waitFor();
      await screenshotWorkflowStudio(
        page,
        "tablet-768-publish-review-light.png",
      );
      await page.getByRole("button", { name: "Back to editor" }).click();
      await screenshotWorkflowStudio(page, "tablet-768-canvas-light.png");
      await tabletContext.close();

      const mobileContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      page = await mobileContext.newPage();
      await routeWorkflowStudioWorkspace(page);
      await seedShellStorage(page, {
        workspaceId: "ws-admin",
        theme: "light",
      });
      await openWorkflowCreate(page, origin);
      await applyPageTheme(page, "light");
      await assertPageTheme(page, "light");
      await screenshotWorkflowStudio(page, "mobile-390-blank-light.png");
      await page.getByRole("button", { name: "Add step" }).click();
      await screenshotWorkflowStudio(page, "mobile-390-add-step-light.png");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Add step" }).click();
      await page.getByRole("button", { name: /^AI agent\b/ }).click();
      await page
        .getByRole("dialog", { name: "Step settings" })
        .waitFor({ timeout: 10_000 });
      await screenshotWorkflowStudio(page, "mobile-390-inspector-light.png");
      const overflow = await readHorizontalOverflow(page);
      expect(overflow.docScrollWidth).toBeLessThanOrEqual(
        overflow.docClientWidth + 2,
      );
      await mobileContext.close();
    } finally {
      await browser.close();
    }
  }, 180_000);

  it("captures extended desktop and mobile acceptance scenarios", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await routeWorkflowStudioWorkspace(page);
      await seedShellStorage(page, {
        workspaceId: "ws-admin",
        theme: "light",
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await openWorkflowCreate(page, origin);
      await fillWorkflowDetails(page, "connected-wf", "Connected WF");

      await page.getByRole("button", { name: /^Decision\b/ }).click();
      await page.getByRole("button", { name: /^AI agent\b/ }).click();
      await page
        .locator("summary", { hasText: "Accessible steps list" })
        .click();
      await page.getByTestId("workflow-keyboard-graph-panel").waitFor();
      const sourceSelect = page.locator("#workflow-connect-source");
      const targetSelect = page.locator("#workflow-connect-target");
      const sourceOptions = await sourceSelect
        .locator("option")
        .allTextContents();
      const decisionKey = sourceOptions.find((label) =>
        label.includes("Decision"),
      );
      const agentKey = sourceOptions.find((label) =>
        label.includes("AI agent"),
      );
      if (decisionKey !== undefined && agentKey !== undefined) {
        await sourceSelect.selectOption({ label: decisionKey });
        await targetSelect.selectOption({ label: agentKey });
        await page.getByRole("button", { name: "Connect steps" }).click();
      }
      await screenshotWorkflowStudio(
        page,
        "desktop-1440-connected-graph-light.png",
      );

      await page.getByRole("button", { name: /^Parallel paths\b/ }).click();
      await page.getByRole("button", { name: /^Merge paths\b/ }).click();
      await screenshotWorkflowStudio(
        page,
        "desktop-1440-parallel-join-light.png",
      );

      await page.getByRole("button", { name: "View issues" }).click();
      await page.getByRole("heading", { name: "Workflow issues" }).waitFor();
      await screenshotWorkflowStudio(
        page,
        "desktop-1440-validation-issues-light.png",
      );
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Review and publish" }).click();
      await page.getByTestId("workflow-publish-review").waitFor();
      await screenshotWorkflowStudio(
        page,
        "desktop-1440-publish-blocked-light.png",
      );
      await page.getByRole("button", { name: "Back to editor" }).click();

      const storedDraft = updateRegistry(
        addAgentNode(createEmptyWorkflowBuilderDraft("ws-admin")),
        { key: "draft-restore", name: "Draft restore" },
      );
      await seedStoredWorkflowDraft(page, storedDraft);
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Restore saved draft" }).click();
      await screenshotWorkflowStudio(
        page,
        "desktop-1440-draft-restore-light.png",
      );

      const partialPage = await browser.newPage();
      await routeWorkflowStudioWorkspace(partialPage);
      await routeWorkflowStudioPartialPublishFailure(partialPage);
      await seedShellStorage(partialPage, {
        workspaceId: "ws-admin",
        theme: "light",
      });
      await partialPage.setViewportSize({ width: 1440, height: 900 });
      await openWorkflowCreate(partialPage, origin);
      await fillWorkflowDetails(partialPage, "partial", "Partial");
      await partialPage.getByRole("button", { name: /^AI agent\b/ }).click();
      await partialPage
        .getByLabel("Agent", { exact: true })
        .selectOption("agent-1");
      await partialPage
        .getByLabel("Agent version (immutable)")
        .selectOption("av-1");
      await partialPage
        .getByRole("button", { name: "Review and publish" })
        .click();
      await partialPage
        .getByRole("button", { name: "Confirm publish" })
        .click();
      await partialPage
        .getByTestId("workflow-publish-upstream-error")
        .waitFor();
      await screenshotWorkflowStudio(
        partialPage,
        "desktop-1440-partial-publish-failure-light.png",
      );
      await partialPage.close();

      await routePublishedWorkflowVersionPage(page);
      await page.goto(`${origin}/workflows/wf-browser/versions/wv-browser-1`, {
        waitUntil: "networkidle",
      });
      await page
        .getByRole("heading", { name: "Run workflow", level: 2 })
        .waitFor({
          timeout: 15_000,
        });
      await screenshotWorkflowStudio(
        page,
        "desktop-1440-run-handoff-light.png",
      );

      const mobileContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const mobilePage = await mobileContext.newPage();
      await routeWorkflowStudioWorkspace(mobilePage);
      await seedShellStorage(mobilePage, {
        workspaceId: "ws-admin",
        theme: "light",
      });
      await openWorkflowCreate(mobilePage, origin);
      await mobilePage.getByRole("button", { name: "Add step" }).click();
      await mobilePage.getByRole("button", { name: /^AI agent\b/ }).click();
      await mobilePage
        .getByRole("dialog", { name: "Step settings" })
        .waitFor({ timeout: 10_000 });
      await mobilePage.keyboard.press("Escape");
      await mobilePage
        .getByRole("dialog", { name: "Step settings" })
        .waitFor({ state: "hidden", timeout: 10_000 });
      await mobilePage.getByRole("button", { name: "View issues" }).click();
      await screenshotWorkflowStudio(
        mobilePage,
        "mobile-390-validation-light.png",
      );
      await mobileContext.close();
    } finally {
      await browser.close();
    }
  }, 240_000);

  it("captures read-only workspace state", async () => {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });

    try {
      const page = await browser.newPage();
      await routeWorkflowStudioWorkspace(page);
      await seedShellStorage(page, {
        workspaceId: "ws-viewer",
        theme: "light",
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await openWorkflowCreate(page, origin);
      await screenshotWorkflowStudio(page, "desktop-1440-readonly-light.png");
    } finally {
      await browser.close();
    }
  }, 120_000);
});
