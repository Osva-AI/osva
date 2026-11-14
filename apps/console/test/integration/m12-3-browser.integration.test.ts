import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import type { Database } from "@osva/db";

import {
  assertNoSentinelLeak,
  consoleJson,
  resetM12_3Data,
  SENTINEL_CREDENTIAL,
  startM12_3HumanConsoleStack,
  startM12_3Infra,
  stopM12_3Infra,
  waitForRunSucceeded,
  HUMAN_PASSWORD,
  OPERATOR_EMAIL,
} from "./m12-3-harness.js";
import type { PostgresTestContext } from "../../../../packages/db/test/integration/postgres-harness.js";
import type { ValkeyTestContext } from "../../../../adapters/bullmq/test/integration/valkey-harness.js";
import { pollUntil } from "./poll-deadline.js";
import { waitForOverview } from "./m18-1a-browser-helpers.js";

function runStepTimelineHeading(kind: string): string {
  switch (kind) {
    case "MODEL":
      return "Model call";
    case "TOOL":
      return "Tool call";
    default:
      return kind.replaceAll("_", " ");
  }
}

async function loginAndSelectWorkspaceA(
  page: Page,
  consoleOrigin: string,
): Promise<void> {
  await page.goto(`${consoleOrigin}/login`);
  await page.fill('input[type="email"]', OPERATOR_EMAIL);
  await page.fill('input[type="password"]', HUMAN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(select-workspace|overview)/, { timeout: 60_000 });

  if (page.url().includes("/select-workspace")) {
    await page
      .locator(".workspace-select-list button")
      .filter({ hasText: "ws-m12-3-a" })
      .click();
    await page.waitForURL(/\/overview/, { timeout: 30_000 });
  }

  await waitForOverview(page);
  await page.getByRole("navigation", { name: "Location" }).waitFor({
    timeout: 30_000,
  });
  await page
    .getByRole("link", { name: "Start guided setup" })
    .waitFor({ timeout: 30_000 });
}

async function assertNoSentinelInPage(page: Page): Promise<void> {
  const html = await page.content();
  expect(html).not.toContain(SENTINEL_CREDENTIAL);
  expect(html.toLowerCase()).not.toContain("session_token");
}

describe("M12.3 browser acceptance (Playwright)", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    ({ postgres, valkey, database } = await startM12_3Infra());
  }, 180_000);

  afterAll(async () => {
    await stopM12_3Infra(database, postgres, valkey);
  });

  beforeEach(async () => {
    await resetM12_3Data(database);
  });

  it("executes cross-capability Console UI journey on real stack", async () => {
    let chromium: typeof import("playwright").chromium | undefined;
    try {
      ({ chromium } = await import("playwright"));
    } catch {
      throw new Error(
        "playwright is required for M12.3 browser acceptance; install root devDependency playwright",
      );
    }

    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });

    const integrity = await stack.copyAgentFixture(
      "model-tool-combined-agent.ts",
    );

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();

      await loginAndSelectWorkspaceA(page, stack.consoleOrigin);

      // Model provider connection
      await page.goto(`${stack.consoleOrigin}/models/connections`);
      await page
        .getByRole("heading", { name: "Provider connections" })
        .waitFor({
          timeout: 30_000,
        });
      await page.fill("#connection-key", "browser-openai");
      await page.fill("#connection-name", "Browser Fake OpenAI");
      await page.selectOption("#connection-provider", "OPENAI");
      await page.getByRole("button", { name: "Create connection" }).click();
      await page.getByRole("link", { name: "Browser Fake OpenAI" }).click();

      await page.fill("#connection-endpoint", stack.fakeOpenAI.origin);
      await page.fill("#connection-credential", "OPENAI_API_KEY");
      await page.getByLabel("Allow private/loopback networks").check();

      const connectionVersionResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().includes("/model-provider-connections/") &&
          response.url().includes("/versions") &&
          response.status() === 201,
      );
      await page
        .getByRole("button", { name: "Append version" })
        .first()
        .click();
      const connectionVersionResponse = await connectionVersionResponsePromise;
      const connectionVersionBody =
        (await connectionVersionResponse.json()) as {
          id: string;
        };
      const connectionVersionId = connectionVersionBody.id;

      await page.fill("#connection-test-model", "gpt-browser-combined");
      await page.getByRole("button", { name: "Test" }).click();
      await page.getByTestId("model-connectivity-guidance").waitFor({
        timeout: 60_000,
      });
      await page.getByText("Connectivity verified").waitFor({
        timeout: 60_000,
      });

      // Model profile + version
      await page.goto(`${stack.consoleOrigin}/models`);
      await page.fill("#model-profile-key", "primary");
      await page.fill("#model-profile-name", "Primary");
      await page.getByRole("button", { name: "Create profile" }).click();
      await page.getByRole("link", { name: "Primary" }).click();
      await page.fill("#model-profile-model", "gpt-browser-combined");
      await page.getByText("Advanced: paste connection version ID").click();
      await page.fill("#model-profile-connection-version", connectionVersionId);
      await page.getByRole("button", { name: "Append version" }).click();
      await page.getByRole("cell", { name: "gpt-browser-combined" }).waitFor({
        timeout: 30_000,
      });

      // MCP connector discover + import
      await page.goto(`${stack.consoleOrigin}/tools/connectors`);
      await page.fill("#connector-key", "browser-mcp");
      await page.fill("#connector-name", "Browser MCP");
      await page.getByRole("button", { name: "Create connector" }).click();
      await page.getByRole("link", { name: "Browser MCP" }).click();
      await page.fill("#connector-endpoint", stack.fakeMcp.endpointUrl);
      const connectorVersionResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().includes("/connectors/") &&
          response.url().includes("/versions") &&
          response.status() === 201,
      );
      await page
        .getByRole("button", { name: "Append version" })
        .first()
        .click();
      const connectorVersionResponse = await connectorVersionResponsePromise;
      const connectorVersionId = (
        (await connectorVersionResponse.json()) as { id: string }
      ).id;
      await page.waitForFunction(
        ({ selectId, versionId }) => {
          const select = document.querySelector<HTMLSelectElement>(
            `#${selectId}`,
          );
          if (select === null) {
            return false;
          }
          return Array.from(select.options).some(
            (option) => option.value === versionId,
          );
        },
        { selectId: "discover-version", versionId: connectorVersionId },
      );
      await page.selectOption("#discover-version", connectorVersionId);
      const discoverResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().includes("/discover") &&
          response.status() === 200,
      );
      await page.getByRole("button", { name: "Discover tools" }).click();
      const discoverResponse = await discoverResponsePromise;
      const discoverBody = (await discoverResponse.json()) as {
        tools?: unknown[];
      };
      expect((discoverBody.tools ?? []).length).toBeGreaterThan(0);
      await page
        .getByText(/Found \d+ remote tool/)
        .waitFor({ timeout: 30_000 });
      await page.locator('tbody input[type="checkbox"]').first().check();
      await page.getByRole("button", { name: "Review import" }).click();
      const importResponsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().includes("/import-mcp-tools") &&
          response.status() === 200,
      );
      await page.getByRole("button", { name: "Confirm import" }).click();
      const importResponse = await importResponsePromise;
      const importBody = (await importResponse.json()) as {
        imported?: ReadonlyArray<{ toolVersionId: string; toolKey: string }>;
      };
      expect((importBody.imported ?? []).length).toBeGreaterThan(0);
      const importedToolVersionId = importBody.imported?.[0]?.toolVersionId;
      expect(importedToolVersionId).toBeTruthy();

      const handoffPanel = page.getByTestId("connector-import-handoff-panel");
      await handoffPanel.waitFor({ timeout: 30_000 });
      await handoffPanel
        .getByRole("heading", { name: "Import complete — next steps" })
        .waitFor({ timeout: 30_000 });
      await handoffPanel
        .getByRole("table", { name: "Imported ToolVersions" })
        .waitFor({ timeout: 30_000 });
      if (importedToolVersionId !== undefined) {
        await handoffPanel
          .getByRole("cell", { name: importedToolVersionId })
          .waitFor({ timeout: 30_000 });
      }
      const agentHandoff = handoffPanel.getByTestId(
        "connector-use-tools-in-agent",
      );
      await agentHandoff.waitFor({ timeout: 30_000 });
      const handoffHref = await agentHandoff.getAttribute("href");
      expect(handoffHref ?? "").toContain("toolVersionIds=");
      expect(handoffHref ?? "").toContain(
        encodeURIComponent(importedToolVersionId ?? ""),
      );
      expect(page.url()).not.toMatch(/\/runs\//);

      // Agent + version with model and tool bindings (developer runtime path)
      await page.goto(`${stack.consoleOrigin}/agents/new/developer`);
      await page.fill("#agent-key", "browser-combined");
      await page.fill("#agent-name", "Browser Combined");
      await page.getByRole("button", { name: "Register Agent" }).click();
      await page.locator("#agent-version-manifest-json").waitFor({
        timeout: 30_000,
      });

      await page.fill("#agent-version-key", "browser-combined");
      await page.fill("#agent-version-name", "Browser Combined");
      await page.selectOption(
        "#agent-version-runtime-type",
        "TRUSTED_TYPESCRIPT",
      );
      await page.fill(
        "#agent-version-entrypoint",
        "model-tool-combined-agent.ts",
      );
      await page.fill("#agent-version-integrity", integrity);

      await page.selectOption("#agent-model-profile", {
        label: "Primary (primary)",
      });
      await page.locator("#agent-primary-model option").nth(1).waitFor({
        state: "attached",
      });
      await page.selectOption("#agent-primary-model", { index: 1 });

      await page.fill("#tool-binding-name-0", "echo");
      await page.locator("#tool-binding-tool-0 option").nth(1).waitFor({
        state: "attached",
      });
      await page.selectOption("#tool-binding-tool-0", { index: 1 });
      await page.locator("#tool-binding-version-0 option").nth(1).waitFor({
        state: "attached",
      });
      await page.selectOption("#tool-binding-version-0", { index: 1 });

      const manifestText = await page.inputValue(
        "#agent-version-manifest-json",
      );
      const manifest = JSON.parse(manifestText) as Record<string, unknown>;
      manifest.capabilities = { model: true, tools: ["echo"] };
      await page.fill(
        "#agent-version-manifest-json",
        JSON.stringify(manifest, null, 2),
      );

      await page.getByRole("button", { name: "Create AgentVersion" }).click();
      await page.waitForURL(
        /\/agents\/[^/]+\/versions\/(?!new)[^/?#]+(\?.*)?$/,
        { timeout: 60_000 },
      );
      expect(page.url()).toContain("published=1");
      expect(page.url()).toContain("studio=test");

      await page.getByTestId("agent-studio-test-handoff-page").waitFor({
        timeout: 30_000,
      });
      await page.getByTestId("agent-studio-test-stage").waitFor({
        timeout: 30_000,
      });
      await page.getByRole("heading", { name: "Test your agent" }).waitFor({
        timeout: 30_000,
      });
      await page.getByTestId("agent-studio-run-launch").waitFor({
        timeout: 30_000,
      });

      await page.getByRole("button", { name: "Run test" }).click();
      await page.getByRole("button", { name: "Confirm test run" }).click();
      await page.waitForURL(/\/runs\/[^/?]+/, { timeout: 60_000 });
      const runUrlMatch = /\/runs\/([^/?]+)/.exec(page.url());
      expect(runUrlMatch).not.toBeNull();
      const runId = runUrlMatch?.[1] ?? "";
      expect(runId.length).toBeGreaterThan(0);

      await waitForRunSucceeded(stack, stack.workspaceA, runId);

      await pollUntil({
        label: "M12.3 run detail V2.6B succeeded label",
        deadlineMs: 30_000,
        intervalMs: 500,
        probe: async () => {
          await page.getByRole("button", { name: "Refresh" }).click();
          const run = await consoleJson(
            stack,
            stack.workspaceA,
            `/api/v1/runs/${encodeURIComponent(runId)}`,
          );
          const apiStatus = (run.body as { status?: string } | null)?.status;
          const uiSucceededVisible = await page
            .locator(".run-detail-outcome-headline")
            .getByText("Succeeded", { exact: true })
            .isVisible()
            .catch(() => false);
          return {
            done: uiSucceededVisible,
            lastState: {
              runId,
              pageUrl: page.url(),
              apiHttpStatus: run.status,
              apiStatus,
              uiSucceededVisible,
            },
          };
        },
      });

      const attemptsResponse = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/runs/${encodeURIComponent(runId)}/attempts`,
      );
      expect(attemptsResponse.status).toBe(200);
      assertNoSentinelLeak(attemptsResponse.text);
      const attemptRows =
        (attemptsResponse.body as { attempts?: Array<{ id: string }> })
          .attempts ?? [];
      expect(attemptRows.length).toBeGreaterThan(0);
      const runAttemptId = attemptRows[attemptRows.length - 1]!.id;

      const stepsResponse = await consoleJson(
        stack,
        stack.workspaceA,
        `/api/v1/runs/${encodeURIComponent(runId)}/attempts/${encodeURIComponent(runAttemptId)}/steps`,
      );
      expect(stepsResponse.status).toBe(200);
      assertNoSentinelLeak(stepsResponse.text);
      const persistedSteps =
        (
          stepsResponse.body as {
            steps?: Array<{ kind: string; bindingName?: string }>;
          }
        ).steps ?? [];
      expect(persistedSteps.length).toBeGreaterThan(0);
      const persistedKinds = persistedSteps.map((step) => step.kind);
      expect(persistedKinds).toContain("MODEL");
      expect(persistedKinds).toContain("TOOL");

      await page.getByRole("button", { name: "Refresh" }).click();
      await page
        .getByText("Loading execution timeline…")
        .waitFor({ state: "hidden", timeout: 30_000 });
      const timeline = page.getByTestId("run-step-timeline");
      await timeline.waitFor({ timeout: 30_000 });
      expect(await timeline.locator(".run-step-timeline-item").count()).toBe(
        persistedSteps.length,
      );
      for (const kind of new Set(persistedKinds)) {
        await timeline
          .getByRole("heading", {
            name: runStepTimelineHeading(kind),
            exact: true,
          })
          .first()
          .waitFor({ timeout: 15_000 });
      }
      for (const step of persistedSteps) {
        if (step.bindingName === undefined || step.bindingName.length === 0) {
          continue;
        }
        await timeline
          .locator(".run-step-timeline-binding", {
            hasText: step.bindingName,
          })
          .first()
          .waitFor({ timeout: 15_000 });
      }

      // Workspace isolation in UI
      await page.getByLabel("Account and workspace").click();
      await page
        .getByRole("button", { name: /Switch/i })
        .first()
        .click();
      await page.getByRole("button", { name: /M12\.3 Workspace B/i }).click();
      await page.goto(`${stack.consoleOrigin}/models/connections`);
      await page
        .getByRole("heading", { name: "Provider connections" })
        .waitFor();
      expect(await page.getByText("Browser Fake OpenAI").count()).toBe(0);

      await assertNoSentinelInPage(page);
    } finally {
      await browser.close();
      await stack.close();
    }
  }, 300_000);
});
