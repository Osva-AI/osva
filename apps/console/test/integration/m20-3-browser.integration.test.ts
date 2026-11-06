import { mkdirSync } from "node:fs";
import path from "node:path";

import type { AgentVersionId, ModelProfileVersionId } from "@osva-ai/contracts";
import type { BuilderProposalV1 } from "@osva/domain/builder";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { minimalNewAgent } from "../../../../packages/domain/test/builder-natural-language-test-helpers.js";

import {
  installMockConsoleApi,
  seedShellStorage,
  startConsolePreviewServer,
  switchShellWorkspace,
} from "./m18-1a-browser-helpers.js";

const consoleRoot = path.resolve(process.cwd());

const M20_3_EVIDENCE_DIR = path.join(consoleRoot, "artifacts", "m20-3-browser");

function ensureM20EvidenceDir(): void {
  mkdirSync(M20_3_EVIDENCE_DIR, { recursive: true });
}

const MODEL_PROFILE_ID = "mp-m20-browser";
const MODEL_PROFILE_VERSION_ID = "mpv-gen-m20-browser" as ModelProfileVersionId;

function researchPipelineProposal(): BuilderProposalV1 {
  const mpv = MODEL_PROFILE_VERSION_ID;
  const mk = (ref: `bpr_${string}`) => ({
    ...minimalNewAgent(ref),
    model: {
      bindingName: "default" as const,
      modelProfileVersionId: mpv,
    },
  });

  return {
    schemaVersion: "1",
    workflowRegistry: {
      key: "wf_nl_browser",
      name: "Research pipeline",
      description: "Browser harness draft",
    },
    agents: [
      {
        kind: "EXISTING" as const,
        ref: "bpr_existing",
        agentVersionId: "av-existing-browser" as AgentVersionId,
      },
      mk("bpr_src"),
      mk("bpr_m1"),
      mk("bpr_m2"),
      mk("bpr_report"),
    ],
    workflow: {
      nodes: [
        {
          key: "existing",
          type: "AGENT" as const,
          agentRef: "bpr_existing",
        },
        { key: "src", type: "AGENT" as const, agentRef: "bpr_src" },
        { key: "fork", type: "PARALLEL" as const },
        { key: "m1", type: "AGENT" as const, agentRef: "bpr_m1" },
        { key: "m2", type: "AGENT" as const, agentRef: "bpr_m2" },
        { key: "join", type: "JOIN" as const },
        {
          key: "ap",
          type: "APPROVAL" as const,
          title: "Approve report draft",
        },
        { key: "rep", type: "AGENT" as const, agentRef: "bpr_report" },
      ],
      edges: [
        { from: "existing", to: "src" },
        { from: "src", to: "fork" },
        { from: "fork", to: "m1" },
        { from: "fork", to: "m2" },
        { from: "m1", to: "join" },
        { from: "m2", to: "join" },
        { from: "join", to: "ap" },
        { from: "ap", to: "rep" },
      ],
    },
    assumptions: [],
    unresolvedRequirements: [],
  };
}

describe("M20.3 NL builder browser acceptance (mock BFF + built client)", () => {
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

  it("describe → generate → graph → edit NEW agent → validate → refresh → workspace isolation; no publish/execute", async () => {
    const { chromium } = await import("playwright");
    const proposalFixture = researchPipelineProposal();

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    const generateRequests: { url: string; body: unknown }[] = [];
    const validateRequests: { url: string; body: unknown }[] = [];
    const forbiddenHits: { method: string; url: string }[] = [];

    try {
      await installMockConsoleApi(page, {
        workspaces: [
          { workspaceId: "ws-admin", name: "Acme Admin", role: "ADMIN" },
          { workspaceId: "ws-dev", name: "Acme Build", role: "DEVELOPER" },
        ],
        nlBuilder: {
          modelProfileId: MODEL_PROFILE_ID,
          modelProfileVersionId: MODEL_PROFILE_VERSION_ID,
          generateProposal: proposalFixture,
          recordForbiddenPosts: true,
          forbiddenHits,
          captures: { generateRequests, validateRequests },
        },
      });

      await seedShellStorage(page, {
        workspaceId: "ws-admin",
        theme: "light",
        sidebarCollapsed: false,
        seedWorkspaceId: false,
      });

      ensureM20EvidenceDir();

      await page.goto(`${origin}/workflows/new/describe`, {
        waitUntil: "networkidle",
      });
      await page
        .getByRole("heading", { name: "Describe with AI", level: 1 })
        .waitFor();
      await page
        .getByRole("textbox", { name: "What should this workflow do?" })
        .waitFor();

      const initialInstruction = await page
        .getByRole("textbox", { name: "What should this workflow do?" })
        .inputValue();
      expect(initialInstruction).toBe("");
      await page.screenshot({
        path: path.join(M20_3_EVIDENCE_DIR, "01-initial-nl.png"),
        fullPage: true,
      });

      await page.waitForFunction(() => {
        const sel = document.querySelector("#nl-model");
        return sel instanceof HTMLSelectElement && sel.options.length > 1;
      });
      await page.selectOption("#nl-model", MODEL_PROFILE_VERSION_ID);
      expect(await page.locator("#nl-model").inputValue()).toBe(
        MODEL_PROFILE_VERSION_ID,
      );

      const instruction =
        "Build a research workflow: one agent gathers sources, two agents analyze in parallel, then join and human approval before a final report agent.";
      await page
        .getByRole("textbox", { name: "What should this workflow do?" })
        .fill(instruction);

      await page.waitForFunction(() => {
        const buttons = [
          ...document.querySelectorAll(".workflow-nl-builder__actions button"),
        ];
        const primary = buttons.find((b) =>
          b.textContent?.includes("Generate draft"),
        );
        return primary instanceof HTMLButtonElement && !primary.disabled;
      });

      const generateResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/v1/builder/proposals/generate") &&
          response.request().method() === "POST" &&
          response.status() === 200,
        { timeout: 30_000 },
      );
      await page.getByRole("button", { name: "Generate draft" }).click();
      await generateResponsePromise;

      expect(generateRequests.length).toBe(1);

      await page.getByTestId("nl-proposed-agents").waitFor({ timeout: 30_000 });
      const genBody = generateRequests[0]?.body as Record<string, unknown>;
      expect(genBody.userInstruction).toBe(instruction);
      expect(genBody.generationModelProfileVersionId).toBe(
        MODEL_PROFILE_VERSION_ID,
      );

      expect(await page.locator(".badge--existing").count()).toBe(1);
      expect(await page.locator(".badge--new").count()).toBe(4);
      expect(
        await page.getByText("bpr_existing", { exact: true }).isVisible(),
      ).toBe(true);

      await page.waitForSelector(".react-flow", { timeout: 30_000 });
      expect(await page.locator(".react-flow__node").count()).toBe(
        proposalFixture.workflow.nodes.length,
      );
      await page.screenshot({
        path: path.join(M20_3_EVIDENCE_DIR, "02-after-generate-graph.png"),
        fullPage: true,
      });

      const newAgentRef = "bpr_report";
      // Topological list uses workflow node keys, not bpr_* refs (report step is key "rep").
      await page.getByRole("button", { name: /rep — AGENT/ }).click();
      expect(await page.locator("#ag-inst").isVisible()).toBe(true);
      const editedInstructions = "Final report with browser harness edit.";
      await page.locator("#ag-inst").fill(editedInstructions);

      await page.getByRole("button", { name: "Revalidate on server" }).click();
      expect(await page.getByText("structurally valid").isVisible()).toBe(true);
      expect(validateRequests.length).toBeGreaterThanOrEqual(1);
      const lastValidate = validateRequests[validateRequests.length - 1]
        ?.body as {
        proposal?: { agents?: { ref?: string; instructions?: string }[] };
      };
      expect(lastValidate.proposal).toBeDefined();
      const reportAgent = lastValidate.proposal?.agents?.find(
        (a) => a.ref === newAgentRef,
      );
      expect(reportAgent?.instructions).toBe(editedInstructions);

      await page.screenshot({
        path: path.join(M20_3_EVIDENCE_DIR, "03-after-revalidate.png"),
        fullPage: true,
      });

      await page.reload({ waitUntil: "networkidle" });
      await page
        .getByRole("heading", { name: "Describe with AI", level: 1 })
        .waitFor();
      expect(
        await page
          .getByRole("textbox", { name: "What should this workflow do?" })
          .inputValue(),
      ).toBe(instruction);
      expect(await page.locator("#nl-model").inputValue()).toBe(
        MODEL_PROFILE_VERSION_ID,
      );
      await page.getByTestId("nl-proposed-agents").waitFor();
      expect(await page.locator("#ag-inst").inputValue()).toBe(
        editedInstructions,
      );

      await switchShellWorkspace(page, "Acme Build");
      await page.waitForFunction(() => {
        return (
          sessionStorage.getItem("osva.console.selectedWorkspaceId") ===
          "ws-dev"
        );
      });
      await page.goto(`${origin}/workflows/new/describe`, {
        waitUntil: "networkidle",
      });
      expect(await page.getByTestId("nl-proposed-agents").count()).toBe(0);
      await page.screenshot({
        path: path.join(M20_3_EVIDENCE_DIR, "04-other-workspace-empty.png"),
        fullPage: true,
      });

      expect(forbiddenHits).toEqual([]);
    } finally {
      await context.close();
      await browser.close();
    }
  });
});
