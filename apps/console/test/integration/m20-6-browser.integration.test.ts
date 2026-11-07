import type { BuilderProposalV1 } from "@osva/domain/builder";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@osva/db";

import {
  assertNoSentinelLeak,
  startM12_3HumanConsoleStack,
  startM12_3Infra,
  stopM12_3Infra,
  resetM12_3Data,
} from "./m12-3-harness.js";
import type { PostgresTestContext } from "../../../../packages/db/test/integration/postgres-harness.js";
import type { ValkeyTestContext } from "../../../../adapters/bullmq/test/integration/valkey-harness.js";
import {
  countWorkflowRuns,
  provisionM20_6OpenAiModelProfiles,
} from "./m20-6-builder-helpers.js";
import { loginHumanWorkspaceA } from "./m13-6-browser-helpers.js";

describe("M20.6 builder browser journey (real BFF + fake provider)", () => {
  let postgres: PostgresTestContext;
  let valkey: ValkeyTestContext;
  let database: Database;

  beforeAll(async () => {
    ({ postgres, valkey, database } = await startM12_3Infra());
  }, 180_000);

  afterAll(async () => {
    await stopM12_3Infra(database, postgres, valkey);
  });

  beforeAll(async () => {
    await resetM12_3Data(database);
  });

  it("simple scenario: generate → publish via Console (real stack, no execution)", async () => {
    const stack = await startM12_3HumanConsoleStack({
      database,
      databaseUrl: postgres.connectionString,
      valkeyUrl: valkey.url,
    });

    try {
      const models = await provisionM20_6OpenAiModelProfiles(
        stack,
        stack.workspaceA,
      );
      const runsBefore = await countWorkflowRuns(stack, stack.workspaceA);

      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();

      const publishRequests: { url: string; body: unknown }[] = [];
      page.on("request", (request) => {
        if (
          request.method() === "POST" &&
          request.url().includes("/api/v1/builder/publications") &&
          !request.url().includes("/prepare")
        ) {
          publishRequests.push({
            url: request.url(),
            body: request.postDataJSON(),
          });
        }
      });

      await loginHumanWorkspaceA(page, stack);
      await page.goto(`${stack.consoleOrigin}/workflows/new/describe`, {
        waitUntil: "networkidle",
      });

      await page.waitForFunction(() => {
        const sel = document.querySelector("#nl-model");
        return sel instanceof HTMLSelectElement && sel.options.length > 1;
      });
      await page.selectOption(
        "#nl-model",
        models.generationModelProfileVersionId,
      );

      const prompt =
        "OSVA_M20_6_SCENARIO=simple\nBuild a single summarization agent workflow.";
      await page
        .getByRole("textbox", { name: "What should this workflow do?" })
        .fill(prompt);

      const generatePromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/builder/proposals/generate") &&
          response.status() === 200,
      );

      await page
        .getByRole("button", { name: "Generate draft" })
        .click({ timeout: 30_000 });

      const generateResponse = await generatePromise;
      const genBody = (await generateResponse.json()) as {
        ok: boolean;
        proposal?: BuilderProposalV1;
        metadata?: {
          generationModelProfileVersionId?: string;
          measuredUsage?: { usageMeasured?: boolean };
        };
      };
      expect(genBody.ok).toBe(true);
      expect(genBody.metadata?.generationModelProfileVersionId).toBe(
        models.generationModelProfileVersionId,
      );
      assertNoSentinelLeak(JSON.stringify(genBody));

      await page
        .getByText("Summarizer (NEW)")
        .waitFor({ state: "visible", timeout: 60_000 });

      await page.getByRole("button", { name: "Review publication" }).click();
      await page
        .getByRole("checkbox", { name: /immutable/i })
        .waitFor({ timeout: 30_000 });
      await page.getByRole("checkbox", { name: /immutable/i }).check();
      await page
        .getByRole("button", { name: "Publish workflow & agents" })
        .click();

      await expect
        .poll(() => publishRequests.length, { timeout: 60_000 })
        .toBeGreaterThanOrEqual(1);

      const publishBody = publishRequests[0]?.body as Record<string, unknown>;
      expect(publishBody.confirm).toBe(true);
      expect(typeof publishBody.expectedPlanDigest).toBe("string");

      await page.getByRole("link", { name: "Open workflow" }).waitFor({
        timeout: 60_000,
      });

      const runsAfter = await countWorkflowRuns(stack, stack.workspaceA);
      expect(runsAfter).toBe(runsBefore);

      await browser.close();
      expect(stack.fakeOpenAI.requests.length).toBeGreaterThan(0);
    } finally {
      await stack.close();
    }
  }, 300_000);
});
