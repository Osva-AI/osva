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
import { pollUntil } from "./poll-deadline.js";
import {
  loginHumanWorkspaceA,
  loginViewerWorkspaceA,
  provisionViewerInWorkspaceA,
  seedEchoAgent,
} from "./m13-6-browser-helpers.js";

async function launchChromium() {
  try {
    const { chromium } = await import("playwright");
    return chromium;
  } catch {
    throw new Error(
      "playwright is required for M13.7.2 browser acceptance; install root devDependency playwright",
    );
  }
}

describe("M13.7.2 browser acceptance (Agent Playground)", () => {
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

  it("runs an echo agent test from the playground and opens Run detail", async () => {
    const chromium = await launchChromium();
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });
    const { agentId, agentVersionId } = await seedEchoAgent(stack);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await loginHumanWorkspaceA(page, stack);
      await page.goto(`${stack.consoleOrigin}/testing/playground`);
      await page
        .getByRole("heading", { name: "Agent playground", level: 1 })
        .waitFor({ timeout: 30_000 });

      await page.selectOption("#playground-agent", agentId);
      await page.selectOption("#playground-version", agentVersionId);
      await page.getByRole("button", { name: "Run test" }).click();

      await pollUntil({
        label: "playground run output",
        deadlineMs: 120_000,
        intervalMs: 500,
        probe: async () => {
          const output = page.getByText("Output", { exact: true });
          const visible = await output.isVisible().catch(() => false);
          const succeeded = await page
            .getByText("SUCCEEDED")
            .first()
            .isVisible()
            .catch(() => false);
          return {
            done: visible && succeeded,
            lastState: { visible, succeeded },
          };
        },
      });

      await page.getByRole("link", { name: "Open Run detail" }).click();
      await page
        .getByRole("heading", { name: "Run", level: 1 })
        .waitFor({ timeout: 30_000 });
    } finally {
      await browser.close();
      await stack.close();
    }
  }, 180_000);

  it("smokes the Testing Studio landing after M13.7.1", async () => {
    const chromium = await launchChromium();
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await loginHumanWorkspaceA(page, stack);
      await page.goto(`${stack.consoleOrigin}/testing`);
      await page
        .getByRole("heading", { name: "Testing Studio", level: 1 })
        .waitFor({ timeout: 30_000 });
      await page
        .getByRole("link", { name: "Open Agent playground" })
        .waitFor({ timeout: 15_000 });
    } finally {
      await browser.close();
      await stack.close();
    }
  }, 120_000);

  it("does not allow viewers to start playground tests", async () => {
    const chromium = await launchChromium();
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });
    const { agentId, agentVersionId } = await seedEchoAgent(stack);
    await provisionViewerInWorkspaceA(stack);

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await loginViewerWorkspaceA(page, stack);
      await page.goto(`${stack.consoleOrigin}/testing/playground`);
      await page
        .getByRole("heading", { name: "Agent playground", level: 1 })
        .waitFor({ timeout: 30_000 });
      await page.selectOption("#playground-agent", agentId);
      await page.selectOption("#playground-version", agentVersionId);
      await page
        .getByRole("button", { name: "Run test" })
        .waitFor({ timeout: 15_000 });
      expect(
        await page.getByRole("button", { name: "Run test" }).isDisabled(),
      ).toBe(true);
      expect(await page.getByText(/cannot EXECUTE test runs/i).count()).toBe(1);
    } finally {
      await browser.close();
      await stack.close();
    }
  }, 120_000);
});
