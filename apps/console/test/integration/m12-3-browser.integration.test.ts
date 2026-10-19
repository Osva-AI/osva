import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import type { Database } from "@osva/db";

import {
  resetM12_3Data,
  SENTINEL_CREDENTIAL,
  startM12_3HumanConsoleStack,
  startM12_3Infra,
  stopM12_3Infra,
  HUMAN_PASSWORD,
  OPERATOR_EMAIL,
} from "./m12-3-harness.js";
import type { PostgresTestContext } from "../../../../packages/db/test/integration/postgres-harness.js";
import type { ValkeyTestContext } from "../../../../adapters/bullmq/test/integration/valkey-harness.js";

async function loginAndSelectWorkspaceA(
  page: Page,
  consoleOrigin: string,
): Promise<void> {
  await page.goto(`${consoleOrigin}/login`);
  await page.fill('input[type="email"]', OPERATOR_EMAIL);
  await page.fill('input[type="password"]', HUMAN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(select-workspace|runs)/, { timeout: 60_000 });

  if (page.url().includes("/select-workspace")) {
    await page
      .locator(".workspace-select-list button")
      .filter({ hasText: "ws-m12-3-a" })
      .click();
    await page.waitForURL(/\/runs/, { timeout: 30_000 });
  }

  await page.getByRole("heading", { name: "Runs" }).waitFor({
    timeout: 30_000,
  });
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
      await page.getByText(/Last connectivity test:/).waitFor({
        timeout: 60_000,
      });

      // Model profile + version
      await page.goto(`${stack.consoleOrigin}/models`);
      await page.fill("#model-profile-key", "primary");
      await page.fill("#model-profile-name", "Primary");
      await page.getByRole("button", { name: "Create profile" }).click();
      await page.getByRole("link", { name: "Primary" }).click();
      await page.fill("#model-profile-model", "gpt-browser-combined");
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
      await page.selectOption("#discover-version", connectorVersionId);
      await page.getByRole("button", { name: "Discover tools" }).click();
      await page.getByText(/Found \d+ tool/).waitFor({ timeout: 30_000 });
      await page.locator('tbody input[type="checkbox"]').first().check();
      await page.getByRole("button", { name: "Review import" }).click();
      await page.getByRole("button", { name: "Confirm import" }).click();
      await page.getByRole("heading", { name: "Import results" }).waitFor({
        timeout: 30_000,
      });

      // Agent + version with model and tool bindings
      await page.goto(`${stack.consoleOrigin}/agents/new`);
      await page.fill("#agent-key", "browser-combined");
      await page.fill("#agent-name", "Browser Combined");
      await page.getByRole("button", { name: "Register agent" }).click();
      await page.getByRole("link", { name: "Create version" }).click();

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
      await page.waitForURL(/\/agents\/.*\/versions\//, { timeout: 60_000 });

      await page.getByRole("button", { name: "Run Agent" }).click();
      await page.getByRole("button", { name: "Confirm start run" }).click();
      await page.waitForURL(/\/runs\//, { timeout: 60_000 });

      await expect
        .poll(
          async () => {
            await page.getByRole("button", { name: "Refresh" }).click();
            return page.getByText("SUCCEEDED", { exact: true }).count();
          },
          { timeout: 120_000 },
        )
        .toBeGreaterThan(0);

      await page.getByRole("button", { name: "Refresh" }).click();
      await page.getByText("Loading run steps…").waitFor({ state: "hidden" });
      const stepRows = page.locator(".data-table tbody tr");
      await stepRows.first().waitFor({ state: "visible", timeout: 30_000 });

      // Workspace isolation in UI
      await page.getByLabel("Workspace switcher").selectOption("ws-m12-3-b");
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
