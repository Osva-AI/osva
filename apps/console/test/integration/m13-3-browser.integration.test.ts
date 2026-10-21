import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Page } from "playwright";
import type { Database } from "@osva/db";

import { ensureConsoleClientDistForBrowserTests } from "./ensure-console-client-dist.js";
import {
  resetM12_3Data,
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
}

describe("M13.3 browser acceptance (no-code Agent Studio)", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    ensureConsoleClientDistForBrowserTests();
    ({ postgres, valkey, database } = await startM12_3Infra());
  }, 240_000);

  afterAll(async () => {
    await stopM12_3Infra(database, postgres, valkey);
  });

  beforeEach(async () => {
    await resetM12_3Data(database);
  });

  it("walks create-agent studio validation and model profile setup", async () => {
    let chromium: typeof import("playwright").chromium | undefined;
    try {
      ({ chromium } = await import("playwright"));
    } catch {
      throw new Error(
        "playwright is required for M13.3 browser acceptance; install root devDependency playwright",
      );
    }

    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await loginAndSelectWorkspaceA(page, stack.consoleOrigin);

      await page.goto(`${stack.consoleOrigin}/agents/new`);
      await page
        .getByRole("heading", { name: "Create Agent", level: 1 })
        .waitFor({
          timeout: 30_000,
        });
      await page.fill("#create-agent-name", "Browser Declarative Agent");
      await page.fill("#studio-instructions", "Answer support questions.");
      expect(
        await page
          .getByRole("button", { name: "Publish agent version" })
          .isDisabled(),
      ).toBe(true);

      await page.goto(`${stack.consoleOrigin}/models/connections`);
      await page.fill("#connection-key", "browser-studio-openai");
      await page.fill("#connection-name", "Studio Fake OpenAI");
      await page.selectOption("#connection-provider", "OPENAI");
      await page.getByRole("button", { name: "Create connection" }).click();
      await page.getByRole("link", { name: "Studio Fake OpenAI" }).click();
      await page.fill("#connection-endpoint", stack.fakeOpenAI.origin);
      await page.fill("#connection-credential", "OPENAI_API_KEY");
      await page.getByLabel("Allow private/loopback networks").check();
      await page
        .getByRole("button", { name: "Append version" })
        .first()
        .click();
      const connectionVersionId = (
        (await (
          await page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              response.url().includes("/model-provider-connections/") &&
              response.url().includes("/versions") &&
              response.status() === 201,
          )
        ).json()) as { id: string }
      ).id;

      await page.goto(`${stack.consoleOrigin}/models`);
      await page.fill("#model-profile-key", "studio-primary");
      await page.fill("#model-profile-name", "Studio Primary");
      await page.getByRole("button", { name: "Create profile" }).click();
      await page.getByRole("link", { name: "Studio Primary" }).click();
      await page.fill("#model-profile-model", "gpt-studio-declarative");
      await page.fill("#model-profile-connection-version", connectionVersionId);
      await page.getByRole("button", { name: "Append version" }).click();
      await page.getByRole("cell", { name: "gpt-studio-declarative" }).waitFor({
        timeout: 30_000,
      });

      await page.goto(`${stack.consoleOrigin}/agents/new`);
      await page.fill("#create-agent-name", "Browser Declarative Agent");
      await page.fill("#studio-instructions", "Answer support questions.");
      await page.selectOption("#agent-model-profile", {
        label: "Studio Primary (studio-primary)",
      });
      await page.locator("#agent-primary-model option").nth(1).waitFor({
        state: "attached",
      });
      await page.selectOption("#agent-primary-model", { index: 1 });
      await page.getByRole("button", { name: "Validate and review" }).click();
      await page.getByText(/Review before publishing/i).waitFor({
        timeout: 30_000,
      });
      await page.getByRole("button", { name: "Publish agent version" }).click();
      await page.getByText(/This AgentVersion is now saved/i).waitFor({
        timeout: 60_000,
      });
      await page.getByRole("heading", { name: "Run Agent" }).waitFor({
        timeout: 30_000,
      });
    } finally {
      await browser.close();
      await stack.close();
    }
  }, 300_000);
});
