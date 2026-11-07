import { mkdirSync } from "node:fs";
import path from "node:path";

import type { ModelProfileVersionId } from "@osva-ai/contracts";
import type { BuilderProposalV1 } from "@osva/domain/builder";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { minimalNewAgent } from "../../../../packages/domain/test/builder-natural-language-test-helpers.js";

import {
  installMockConsoleApi,
  seedShellStorage,
  startConsolePreviewServer,
} from "./m18-1a-browser-helpers.js";

const MODEL_PROFILE_VERSION_ID = "mpv-browser-pub" as ModelProfileVersionId;

const EVIDENCE_DIR = path.join(
  path.resolve(process.cwd()),
  "artifacts",
  "m20-4-browser",
);

function ensureEvidenceDir(): void {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
}

function draftProposal(): BuilderProposalV1 {
  return {
    schemaVersion: "1",
    workflowRegistry: {
      key: "wf_pub_browser",
      name: "Publication browser WF",
    },
    agents: [
      {
        ...minimalNewAgent("bpr_a"),
        agentKey: "browser_pub_agent",
        agentName: "Browser publish agent",
        model: {
          bindingName: "default",
          modelProfileVersionId: MODEL_PROFILE_VERSION_ID,
        },
      },
    ],
    workflow: {
      nodes: [{ key: "n1", type: "AGENT", agentRef: "bpr_a" }],
      edges: [],
    },
    assumptions: ["Fixture assumption"],
    unresolvedRequirements: [],
  };
}

describe("M20.4 NL builder publication (mock BFF)", () => {
  let origin = "";
  let stopServer: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const server = await startConsolePreviewServer();
    origin = server.origin;
    stopServer = server.stop;
  }, 120_000);

  afterAll(async () => {
    await stopServer?.();
  });

  it("review → confirm → publish → retry same idempotency → no workflow execution", async () => {
    const { chromium } = await import("playwright");
    const proposal = draftProposal();
    const planDigest = "digest-browser-m20-4-publication";
    const prepareRequests: { url: string; body: unknown }[] = [];
    const publishRequests: { url: string; body: unknown }[] = [];
    const forbiddenHits: { method: string; url: string }[] = [];

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await installMockConsoleApi(page, {
        nlBuilder: {
          modelProfileId: "mp-browser-pub",
          modelProfileVersionId: MODEL_PROFILE_VERSION_ID,
          generateProposal: proposal,
          recordForbiddenPosts: true,
          forbiddenHits,
          publication: {
            planDigest,
            workflowId: "wf-browser-published",
            workflowVersionId: "wfv-browser-1",
            publicationId: "bpub-browser-1",
            abortFirstPublish: true,
          },
          captures: {
            generateRequests: [],
            validateRequests: [],
            prepareRequests,
            publishRequests,
          },
        },
      });

      await seedShellStorage(page, { workspaceId: "ws-admin" });

      await page.addInitScript(
        (envelope) => {
          sessionStorage.setItem(
            "osva.builder.nl.1:ws-admin",
            JSON.stringify(envelope),
          );
        },
        {
          schemaVersion: "1",
          workspaceId: "ws-admin",
          updatedAt: "2099-01-01T00:00:00.000Z",
          instruction: "Publish this workflow",
          generationModelProfileVersionId: "mpv-browser-pub",
          proposal,
          publicationIdempotencyKey: "browser-idem-key-1",
        },
      );

      ensureEvidenceDir();
      await page.goto(`${origin}/workflows/new/describe`, {
        waitUntil: "networkidle",
      });
      await page.getByTestId("nl-publication-review").waitFor();

      await page.getByRole("button", { name: "Review publication" }).click();
      await expect
        .poll(() => prepareRequests.length, { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1);

      await page
        .getByRole("checkbox", {
          name: /immutable/i,
        })
        .check();
      await page
        .getByRole("button", { name: "Publish workflow & agents" })
        .click();

      await page.getByText(/result unknown/i).waitFor({ timeout: 15_000 });
      expect(publishRequests.length).toBe(1);
      const firstBody = publishRequests[0]?.body as Record<string, unknown>;
      expect(firstBody.idempotencyKey).toBe("browser-idem-key-1");
      expect(firstBody.confirm).toBe(true);

      await page.screenshot({
        path: path.join(EVIDENCE_DIR, "01-unknown-after-abort.png"),
        fullPage: true,
      });

      await page
        .getByRole("button", { name: "Publish workflow & agents" })
        .click();
      await expect
        .poll(() => publishRequests.length, { timeout: 15_000 })
        .toBeGreaterThanOrEqual(2);
      const secondBody = publishRequests[1]?.body as Record<string, unknown>;
      expect(secondBody.idempotencyKey).toBe("browser-idem-key-1");

      await page.getByRole("link", { name: "Open workflow" }).waitFor();
      await page.screenshot({
        path: path.join(EVIDENCE_DIR, "02-published.png"),
        fullPage: true,
      });

      expect(forbiddenHits.some((h) => h.url.includes("/workflow-runs"))).toBe(
        false,
      );
      expect(
        forbiddenHits.some(
          (h) => h.url.includes("/runs") && h.method === "POST",
        ),
      ).toBe(false);
    } finally {
      await context.close();
      await browser.close();
    }
  });
});
