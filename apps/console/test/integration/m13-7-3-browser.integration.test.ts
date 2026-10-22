import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ensureConsoleClientDistForBrowserTests } from "./ensure-console-client-dist.js";
import {
  resetM12_3Data,
  startM12_3HumanConsoleStack,
  startM12_3Infra,
  stopM12_3Infra,
} from "./m12-3-harness.js";
import type { PostgresTestContext } from "../../../../packages/db/test/integration/postgres-harness.js";
import type { ValkeyTestContext } from "../../../../adapters/bullmq/test/integration/valkey-harness.js";
import type { Database } from "@osva/db";
import {
  loginHumanWorkspaceA,
  loginViewerWorkspaceA,
  provisionViewerInWorkspaceA,
} from "./m13-6-browser-helpers.js";

async function launchChromium() {
  try {
    const { chromium } = await import("playwright");
    return chromium;
  } catch {
    throw new Error(
      "playwright is required for M13.7.3 browser acceptance; install root devDependency playwright",
    );
  }
}

describe("M13.7.3 browser acceptance (Test Suite Builder)", () => {
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

  it("creates, publishes, versions, and validates evaluation suites", async () => {
    const chromium = await launchChromium();
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });

    const suiteKey = `browser-suite-${Date.now()}`;
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await loginHumanWorkspaceA(page, stack);
      await page.goto(`${stack.consoleOrigin}/testing/suites/new`);
      await page
        .getByRole("heading", { name: "Create evaluation suite", level: 1 })
        .waitFor({ timeout: 30_000 });

      await page.fill("#suite-key", suiteKey);
      await page.fill("#suite-name", "Browser acceptance suite");
      await page.getByRole("button", { name: "Create suite" }).click();

      await page
        .getByRole("heading", { name: "Draft suite version", level: 1 })
        .waitFor({ timeout: 30_000 });

      const caseKeys = page.locator('input[id^="case-key-"]');
      expect(await caseKeys.count()).toBe(1);

      await page.locator('input[id^="case-key-"]').first().fill("case-a");
      await page
        .locator('textarea[id^="case-input-"]')
        .first()
        .fill(JSON.stringify({ prompt: "alpha" }, null, 2));
      await page
        .locator('textarea[id^="case-expected-"]')
        .first()
        .fill(JSON.stringify({ echoed: { prompt: "alpha" } }, null, 2));

      await page.getByRole("button", { name: "Add case" }).click();
      expect(await caseKeys.count()).toBe(2);

      await page.locator('input[id^="case-key-"]').nth(1).fill("case-b");
      await page
        .locator('textarea[id^="case-input-"]')
        .nth(1)
        .fill(JSON.stringify({ prompt: "beta" }, null, 2));
      await page
        .locator('textarea[id^="case-expected-"]')
        .nth(1)
        .fill(JSON.stringify({ echoed: { prompt: "beta" } }, null, 2));

      await page.getByRole("button", { name: "Publish version" }).click();
      await page
        .getByRole("heading", { name: "Suite version v1", level: 1 })
        .waitFor({ timeout: 30_000 });
      expect(await page.getByText("case-a", { exact: true }).count()).toBe(1);
      expect(await page.getByText("case-b", { exact: true }).count()).toBe(1);

      const versionOneUrl = page.url();

      await page.getByRole("link", { name: "Create new version" }).click();
      await page
        .getByRole("heading", { name: "Draft suite version", level: 1 })
        .waitFor({ timeout: 30_000 });

      await page.locator('input[id^="case-key-"]').first().fill("case-a");
      await page
        .locator('textarea[id^="case-expected-"]')
        .first()
        .fill(JSON.stringify({ echoed: { prompt: "alpha-updated" } }, null, 2));

      await page.getByRole("button", { name: "Publish version" }).click();
      await page
        .getByRole("heading", { name: "Suite version v2", level: 1 })
        .waitFor({ timeout: 30_000 });

      await page.goto(versionOneUrl);
      await page
        .getByRole("heading", { name: "Suite version v1", level: 1 })
        .waitFor({ timeout: 30_000 });
      expect(
        await page.getByText('"prompt": "alpha"', { exact: false }).count(),
      ).toBeGreaterThan(0);
      expect(
        await page.getByText("alpha-updated", { exact: false }).count(),
      ).toBe(0);

      await page.goto(`${stack.consoleOrigin}/testing/suites/new`);
      await page.fill("#suite-key", `${suiteKey}-validation`);
      await page.fill("#suite-name", "Validation suite");
      await page.getByRole("button", { name: "Create suite" }).click();
      await page
        .getByRole("heading", { name: "Draft suite version", level: 1 })
        .waitFor({ timeout: 30_000 });

      await page.locator('input[id^="case-key-"]').first().fill("dup");
      await page.locator('textarea[id^="case-input-"]').first().fill("{}");
      await page.locator('textarea[id^="case-expected-"]').first().fill("{}");
      await page.getByRole("button", { name: "Add case" }).click();
      await page.locator('input[id^="case-key-"]').nth(1).fill("dup");
      await page.locator('textarea[id^="case-input-"]').nth(1).fill("{}");
      await page.locator('textarea[id^="case-expected-"]').nth(1).fill("{}");
      await page.getByRole("button", { name: "Publish version" }).click();
      expect(
        await page.getByText(/Duplicate case key/i).count(),
      ).toBeGreaterThan(0);

      await page.locator('textarea[id^="case-input-"]').first().fill("{");
      await page.getByRole("button", { name: "Publish version" }).click();
      expect(await page.getByText(/Invalid JSON syntax/i).count()).toBe(1);
    } finally {
      await browser.close();
      await stack.close();
    }
  }, 180_000);

  it("does not allow viewers to create or publish suites", async () => {
    const chromium = await launchChromium();
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });
    await provisionViewerInWorkspaceA(stack);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await loginViewerWorkspaceA(page, stack);
      await page.goto(`${stack.consoleOrigin}/testing`);
      await page
        .getByRole("heading", { name: "Testing Studio", level: 1 })
        .waitFor({ timeout: 30_000 });
      expect(
        await page
          .getByRole("link", { name: "Create evaluation suite" })
          .count(),
      ).toBe(0);

      await page.goto(`${stack.consoleOrigin}/testing/suites/new`);
      await page
        .getByRole("heading", { name: "Create evaluation suite", level: 1 })
        .waitFor({ timeout: 30_000 });
      expect(
        await page.getByRole("button", { name: "Create suite" }).isDisabled(),
      ).toBe(true);
      expect(await page.getByText(/EDITOR or ADMIN role/i).count()).toBe(1);
    } finally {
      await browser.close();
      await stack.close();
    }
  }, 120_000);
});
