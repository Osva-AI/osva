import type { ModelProfileId, ModelProfileVersionId } from "@osva-ai/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { ModelProfile, ModelProfileVersion } from "@osva/domain";
import {
  baseProposal,
  minimalNewAgent,
  publicationBaseProposal,
} from "./support/builder-proposal-fixtures.js";

import { authorizationHeader, createTestWebApplication } from "./test-web.js";
import { closeHttpServer, listenHttpServer } from "../src/server.js";

const TEST_NOW = new Date("2020-01-01T00:00:00.000Z");

async function seedModelProfile(
  ctx: Awaited<ReturnType<typeof createTestWebApplication>>,
): Promise<ModelProfileVersionId> {
  const mp = ModelProfile.create({
    id: "mp-http-pub" as ModelProfileId,
    workspaceId: ctx.workspaceId,
    key: "default",
    name: "Default",
    createdAt: TEST_NOW,
  });
  await ctx.modelProfiles.saveModelProfile(mp);
  const mpv = ModelProfileVersion.create({
    id: "mpv-http-pub" as ModelProfileVersionId,
    modelProfileId: mp.id,
    version: 1,
    provider: "OPENAI",
    model: "gpt-test",
    createdAt: TEST_NOW,
  });
  await ctx.modelProfiles.saveModelProfileVersion(mpv);
  return mpv.id;
}

describe("builder-http", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("requires authentication", async () => {
    const ctx = await createTestWebApplication();
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;
    const response = await fetch(`${origin}/v1/builder/proposals/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(401);
  });

  it("POST refine returns 422 on stale base digest", async () => {
    const ctx = await createTestWebApplication();
    servers.push(ctx.server);
    await seedModelProfile(ctx);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;
    const proposal = baseProposal();
    const response = await fetch(`${origin}/v1/builder/proposals/refine`, {
      method: "POST",
      headers: {
        ...authorizationHeader(ctx.testApiKey.plaintextToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        currentProposal: proposal,
        refinementInstruction: "Add a step.",
        expectedBaseProposalDigest: "sha256:not-a-real-digest",
        generationModelProfileVersionId: "mpv-http-pub",
      }),
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      ok: boolean;
      errorCode?: string;
    };
    expect(body.ok).toBe(false);
    expect(body.errorCode).toBe("STALE_BASE_PROPOSAL_DIGEST");
  });

  it("POST validate returns structured result for minimal invalid body", async () => {
    const ctx = await createTestWebApplication();
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;
    const response = await fetch(`${origin}/v1/builder/proposals/validate`, {
      method: "POST",
      headers: {
        ...authorizationHeader(ctx.testApiKey.plaintextToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ notAProposal: true }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; issues: unknown[] };
    expect(body.ok).toBe(false);
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("POST validate unwraps { proposal } envelope same as raw body", async () => {
    const ctx = await createTestWebApplication();
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;
    const wrapped = await fetch(`${origin}/v1/builder/proposals/validate`, {
      method: "POST",
      headers: {
        ...authorizationHeader(ctx.testApiKey.plaintextToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ proposal: { notAProposal: true } }),
    });
    expect(wrapped.status).toBe(200);
    const bodyWrapped = (await wrapped.json()) as {
      ok: boolean;
      issues: unknown[];
    };

    const raw = await fetch(`${origin}/v1/builder/proposals/validate`, {
      method: "POST",
      headers: {
        ...authorizationHeader(ctx.testApiKey.plaintextToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ notAProposal: true }),
    });
    expect(raw.status).toBe(200);
    const bodyRaw = (await raw.json()) as { ok: boolean; issues: unknown[] };

    expect(bodyWrapped).toEqual(bodyRaw);
  });

  it("POST publications/prepare is read-only on registry (no new agents)", async () => {
    const ctx = await createTestWebApplication();
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;
    const beforeAgents = await fetch(`${origin}/v1/agents`, {
      headers: authorizationHeader(ctx.testApiKey.plaintextToken),
    });
    const beforeList = (await beforeAgents.json()) as { items?: unknown[] };

    const response = await fetch(`${origin}/v1/builder/publications/prepare`, {
      method: "POST",
      headers: {
        ...authorizationHeader(ctx.testApiKey.plaintextToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        proposal: {
          schemaVersion: "1",
          workflowRegistry: { key: "x", name: "X" },
          agents: [],
          workflow: { nodes: [], edges: [] },
          assumptions: [],
          unresolvedRequirements: [],
        },
      }),
    });
    expect(response.status).toBe(200);

    const afterAgents = await fetch(`${origin}/v1/agents`, {
      headers: authorizationHeader(ctx.testApiKey.plaintextToken),
    });
    const afterList = (await afterAgents.json()) as { items?: unknown[] };
    expect(afterList).toEqual(beforeList);
  });

  it("POST publications requires confirm flag", async () => {
    const ctx = await createTestWebApplication();
    servers.push(ctx.server);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;
    const response = await fetch(`${origin}/v1/builder/publications`, {
      method: "POST",
      headers: {
        ...authorizationHeader(ctx.testApiKey.plaintextToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        confirm: false,
        expectedPlanDigest: "d",
        idempotencyKey: "k",
      }),
    });
    expect(response.status).toBe(400);
  });

  it("POST publications returns 409 on stale plan digest", async () => {
    const ctx = await createTestWebApplication();
    servers.push(ctx.server);
    const mpvId = await seedModelProfile(ctx);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;
    const proposal = baseProposal({
      workflowRegistry: { key: "http-stale-wf", name: "Stale" },
      agents: [
        {
          ...minimalNewAgent("bpr_a"),
          agentKey: "http_stale_agent",
          model: { bindingName: "default", modelProfileVersionId: mpvId },
        },
      ],
    });

    const response = await fetch(`${origin}/v1/builder/publications`, {
      method: "POST",
      headers: {
        ...authorizationHeader(ctx.testApiKey.plaintextToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        confirm: true,
        proposal,
        expectedPlanDigest: "not-the-real-digest",
        idempotencyKey: "stale-http-key",
      }),
    });
    expect(response.status).toBe(409);
  });

  it("POST publications replays idempotently in memory harness", async () => {
    const ctx = await createTestWebApplication();
    servers.push(ctx.server);
    const mpvId = await seedModelProfile(ctx);
    const port = await listenHttpServer(ctx.server, "127.0.0.1", 0);
    const origin = `http://127.0.0.1:${String(port)}`;
    const proposal = publicationBaseProposal(mpvId);
    const proposalWithRegistry = {
      ...proposal,
      workflowRegistry: { key: "http-idem-wf", name: "Idem" },
      agents: proposal.agents.map((agent) => ({
        ...agent,
        agentKey: "http_idem_agent",
      })),
    };

    const prepare = await fetch(`${origin}/v1/builder/publications/prepare`, {
      method: "POST",
      headers: {
        ...authorizationHeader(ctx.testApiKey.plaintextToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ proposal: proposalWithRegistry }),
    });
    const plan = (await prepare.json()) as { planDigest: string };
    const body = {
      confirm: true,
      proposal: proposalWithRegistry,
      expectedPlanDigest: plan.planDigest,
      idempotencyKey: "http-idem-replay",
    };

    const first = await fetch(`${origin}/v1/builder/publications`, {
      method: "POST",
      headers: {
        ...authorizationHeader(ctx.testApiKey.plaintextToken),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(201);
    const second = await fetch(`${origin}/v1/builder/publications`, {
      method: "POST",
      headers: {
        ...authorizationHeader(ctx.testApiKey.plaintextToken),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    expect(second.status).toBe(200);
    const r1 = (await first.json()) as { receipt: { workflowId: string } };
    const r2 = (await second.json()) as {
      replay: boolean;
      receipt: { workflowId: string };
    };
    expect(r2.replay).toBe(true);
    expect(r2.receipt.workflowId).toBe(r1.receipt.workflowId);
  });
});
