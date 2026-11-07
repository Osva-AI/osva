import type { ModelProfileVersionId } from "@osva-ai/contracts";
import type { BuilderProposalV1 } from "@osva/domain/builder";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { minimalNewAgent } from "../../../../packages/domain/test/builder-natural-language-test-helpers.js";

import {
  installMockConsoleApi,
  seedShellStorage,
  startConsolePreviewServer,
} from "./m18-1a-browser-helpers.js";

const MODEL_PROFILE_VERSION_ID = "mpv-browser-m20-5" as ModelProfileVersionId;
const ALT_MODEL_PROFILE_VERSION_ID =
  "mpv-browser-m20-5-alt" as ModelProfileVersionId;

function baseDraft(): BuilderProposalV1 {
  return {
    schemaVersion: "1",
    workflowRegistry: { key: "wf_refine", name: "Research draft" },
    agents: [
      {
        ...minimalNewAgent("bpr_a"),
        agentKey: "research",
        agentName: "Research",
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
    assumptions: [],
    unresolvedRequirements: [],
  };
}

function withFactCheck(base: BuilderProposalV1): BuilderProposalV1 {
  const fc = {
    ...minimalNewAgent("bpr_fc"),
    agentKey: "fact_check",
    agentName: "Fact check",
    model: {
      bindingName: "default",
      modelProfileVersionId: MODEL_PROFILE_VERSION_ID,
    },
  };
  return {
    ...base,
    agents: [...base.agents, fc],
    workflow: {
      nodes: [
        ...base.workflow.nodes,
        { key: "n_fc", type: "AGENT", agentRef: "bpr_fc" },
      ],
      edges: [{ from: "n1", to: "n_fc" }],
    },
  };
}

function withResearchModelAlt(base: BuilderProposalV1): BuilderProposalV1 {
  return {
    ...base,
    agents: base.agents.map((a) =>
      a.kind === "NEW" && a.ref === "bpr_a"
        ? {
            ...a,
            model: {
              ...a.model,
              modelProfileVersionId: ALT_MODEL_PROFILE_VERSION_ID,
            },
          }
        : a,
    ),
  };
}

function proposalFromRefineBody(body: unknown): BuilderProposalV1 {
  const current = (body as { currentProposal?: BuilderProposalV1 })
    .currentProposal;
  if (current === undefined) {
    return baseDraft();
  }
  const instruction = String(
    (body as { refinementInstruction?: string }).refinementInstruction ?? "",
  );
  if (instruction.toLowerCase().includes("fact")) {
    return withFactCheck(current);
  }
  if (instruction.toLowerCase().includes("model")) {
    return withResearchModelAlt(current);
  }
  return current;
}

describe("M20.5 NL builder refinement (mock BFF)", () => {
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

  it("refinement → undo → publication with plan invalidation (no execution)", async () => {
    const { chromium } = await import("playwright");
    const initial = baseDraft();
    const refineRequests: { url: string; body: unknown }[] = [];
    const prepareRequests: { url: string; body: unknown }[] = [];
    const publishRequests: { url: string; body: unknown }[] = [];
    const forbiddenHits: { method: string; url: string }[] = [];
    const planDigest = "digest-m20-5-refine-publication";

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await installMockConsoleApi(page, {
        nlBuilder: {
          modelProfileId: "mp-browser-m20-5",
          modelProfileVersionId: MODEL_PROFILE_VERSION_ID,
          generateProposal: initial,
          refineProposalForRequest: (body) => proposalFromRefineBody(body),
          recordForbiddenPosts: true,
          forbiddenHits,
          publication: {
            planDigest,
            workflowId: "wf-m20-5-published",
            workflowVersionId: "wfv-m20-5-1",
            publicationId: "bpub-m20-5-1",
          },
          captures: {
            generateRequests: [],
            validateRequests: [],
            refineRequests,
            prepareRequests,
            publishRequests,
          },
        },
      });

      await seedShellStorage(page, { workspaceId: "ws-admin" });
      await page.goto(`${origin}/workflows/new/describe`, {
        waitUntil: "networkidle",
      });

      await page
        .getByRole("textbox", { name: "What should this workflow do?" })
        .fill("Research workflow");
      await page.waitForFunction(() => {
        const sel = document.querySelector("#nl-model");
        return sel instanceof HTMLSelectElement && sel.options.length > 1;
      });
      await page.selectOption("#nl-model", MODEL_PROFILE_VERSION_ID);
      await page.getByRole("button", { name: "Generate draft" }).click();
      await page.getByTestId("nl-proposed-agents").waitFor({ timeout: 30_000 });

      await page
        .getByRole("textbox", { name: "Refinement instruction" })
        .fill("Add fact-check agent");
      await page.getByRole("button", { name: "Refine draft" }).click();
      await page
        .getByTestId("nl-candidate-review")
        .waitFor({ timeout: 30_000 });
      await page.getByRole("button", { name: "Accept changes" }).click();
      expect(await page.getByText("bpr_fc", { exact: true }).isVisible()).toBe(
        true,
      );

      await page.getByRole("button", { name: "Review publication" }).click();
      await expect
        .poll(() => prepareRequests.length, { timeout: 15_000 })
        .toBe(1);
      const prepareBody1 = prepareRequests[0]?.body as {
        proposal?: BuilderProposalV1;
      };
      expect(
        prepareBody1.proposal?.agents.some((a) => a.ref === "bpr_fc"),
      ).toBe(true);
      await page
        .getByText(planDigest.slice(0, 12))
        .waitFor({ timeout: 10_000 });

      await page
        .getByRole("textbox", { name: "Refinement instruction" })
        .fill("Change model binding");
      await page.getByRole("button", { name: "Refine draft" }).click();
      await page
        .getByTestId("nl-candidate-review")
        .waitFor({ timeout: 30_000 });
      await page.getByRole("button", { name: "Accept changes" }).click();

      expect(
        await page
          .getByText(planDigest.slice(0, 12))
          .isVisible()
          .catch(() => false),
      ).toBe(false);

      await page
        .getByRole("button", { name: "Undo last accepted change" })
        .click();
      expect(await page.getByText("bpr_fc", { exact: true }).isVisible()).toBe(
        true,
      );

      await page.reload({ waitUntil: "networkidle" });
      expect(await page.getByText("bpr_fc", { exact: true }).isVisible()).toBe(
        true,
      );

      await page.getByRole("button", { name: "Review publication" }).click();
      await expect
        .poll(() => prepareRequests.length, { timeout: 15_000 })
        .toBe(2);
      const prepareBody2 = prepareRequests[1]?.body as {
        proposal?: BuilderProposalV1;
      };
      const researchAgent = prepareBody2.proposal?.agents.find(
        (a) => a.ref === "bpr_a" && a.kind === "NEW",
      );
      expect(
        researchAgent !== undefined &&
          researchAgent.kind === "NEW" &&
          researchAgent.model.modelProfileVersionId ===
            MODEL_PROFILE_VERSION_ID,
      ).toBe(true);
      expect(
        prepareBody2.proposal?.agents.some((a) => a.ref === "bpr_fc"),
      ).toBe(true);

      await page.getByRole("checkbox", { name: /immutable/i }).check();
      await page
        .getByRole("button", { name: "Publish workflow & agents" })
        .click();
      await expect
        .poll(() => publishRequests.length, { timeout: 15_000 })
        .toBeGreaterThanOrEqual(1);

      const publishBody = publishRequests[0]?.body as Record<string, unknown>;
      expect(publishBody.confirm).toBe(true);
      expect(publishBody.expectedPlanDigest).toBe(planDigest);
      const publishedProposal = publishBody.proposal as BuilderProposalV1;
      expect(publishedProposal.agents.some((a) => a.ref === "bpr_fc")).toBe(
        true,
      );

      await page.getByRole("link", { name: "Open workflow" }).waitFor({
        timeout: 20_000,
      });

      expect(refineRequests.length).toBeGreaterThanOrEqual(2);
      expect(
        forbiddenHits.filter((h) => h.url.includes("/api/v1/runs")),
      ).toHaveLength(0);
    } finally {
      await context.close();
      await browser.close();
    }
  });

  it("unknown publication preserves idempotency and blocks refinement", async () => {
    const { chromium } = await import("playwright");
    const proposal = baseDraft();
    const withFc = withFactCheck(proposal);
    const idempotencyKey = "m20-5-unknown-pub-key";
    const publishRequests: { url: string; body: unknown }[] = [];

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await installMockConsoleApi(page, {
        nlBuilder: {
          modelProfileId: "mp-browser-m20-5",
          modelProfileVersionId: MODEL_PROFILE_VERSION_ID,
          generateProposal: proposal,
          publication: {
            planDigest: "digest-unknown-m20-5",
            workflowId: "wf-unknown",
            workflowVersionId: "wfv-unknown",
            publicationId: "bpub-unknown",
            abortFirstPublish: true,
          },
          captures: {
            generateRequests: [],
            validateRequests: [],
            refineRequests: [],
            prepareRequests: [],
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
          instruction: "Publish after refine",
          generationModelProfileVersionId: MODEL_PROFILE_VERSION_ID,
          proposal: withFc,
          publicationIdempotencyKey: idempotencyKey,
        },
      );

      await page.goto(`${origin}/workflows/new/describe`, {
        waitUntil: "networkidle",
      });
      await page.getByTestId("nl-publication-review").waitFor();

      await page.getByRole("button", { name: "Review publication" }).click();
      await page.getByRole("checkbox", { name: /immutable/i }).check();
      await page
        .getByRole("button", { name: "Publish workflow & agents" })
        .click();
      await page.getByText(/result unknown/i).waitFor({ timeout: 15_000 });
      expect(
        await page
          .getByTestId("nl-refinement-panel")
          .isVisible()
          .catch(() => false),
      ).toBe(false);

      expect(publishRequests.length).toBe(1);
      expect(
        (publishRequests[0]?.body as { idempotencyKey?: string })
          .idempotencyKey,
      ).toBe(idempotencyKey);

      const draftRaw = await page.evaluate(() =>
        sessionStorage.getItem("osva.builder.nl.1:ws-admin"),
      );
      const draft = JSON.parse(draftRaw ?? "{}") as {
        publicationIdempotencyKey?: string;
        proposal?: BuilderProposalV1;
      };
      expect(draft.publicationIdempotencyKey).toBe(idempotencyKey);
      expect(draft.proposal?.agents.some((a) => a.ref === "bpr_fc")).toBe(true);
    } finally {
      await context.close();
      await browser.close();
    }
  });
});
