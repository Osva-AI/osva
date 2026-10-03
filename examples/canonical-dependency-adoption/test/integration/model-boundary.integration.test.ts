import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fetchJson } from "../../../../apps/worker/test/integration/integration-auth.js";
import { buildWorkflowRunInput } from "../../scripts/lib/args.js";
import {
  startCanonicalInfra,
  stopCanonicalInfra,
  waitUntil,
  withCanonicalStack,
  type CanonicalInfra,
} from "./canonical-stack.js";

describe("canonical model boundary smoke", () => {
  let infra: CanonicalInfra;

  beforeAll(async () => {
    infra = await startCanonicalInfra();
  }, 300_000);

  afterAll(async () => {
    await stopCanonicalInfra(infra);
  }, 300_000);

  it("executes Research generateText through ModelGateway and the fake OpenAI server", async () => {
    const requestId = randomUUID();
    await withCanonicalStack(infra, {}, async (stack) => {
      const agentsResponse = await fetchJson(`${stack.origin}/v1/agents`);
      const agents = agentsResponse.body as {
        agents: Array<{ key: string; id: string }>;
      };
      const researchAgent = agents.agents.find(
        (agent) => agent.key === "canonical-dependency-research",
      );
      expect(researchAgent).toBeDefined();

      const runCreated = await fetchJson(`${stack.origin}/v1/runs`, {
        method: "POST",
        body: {
          agentId: researchAgent!.id,
          agentVersionId: stack.seed.researchAgentVersionId,
          input: buildWorkflowRunInput({
            requestId,
            packageName: "zod",
            useCase: "Runtime validation for public API request bodies.",
            constraints: ["Permissive license required."],
          }),
        },
      });
      expect(runCreated.status).toBe(201);

      const runId = (runCreated.body as { run: { id: string } }).run.id;

      await waitUntil(async () => {
        const run = await fetchJson(`${stack.origin}/v1/runs/${runId}`);
        return (run.body as { status?: string }).status === "SUCCEEDED";
      }, 120_000);

      expect(stack.fakeModel.callCount).toBeGreaterThanOrEqual(1);
      const modelRequest = stack.fakeModel.requests.find((request) =>
        request.url.includes("/responses"),
      );
      expect(modelRequest).toBeDefined();
      expect(modelRequest!.method).toBe("POST");
      const requestBody = modelRequest!.body as { model?: string };
      expect(requestBody.model).toBe("gpt-4.1-mini");

      const attempts = await fetchJson(
        `${stack.origin}/v1/runs/${runId}/attempts`,
      );
      const attemptList = (
        attempts.body as {
          attempts: Array<{ output?: { research?: { findings: string[] } } }>;
        }
      ).attempts;
      expect(
        attemptList[0]?.output?.research?.findings?.length,
      ).toBeGreaterThan(0);
    });
  }, 300_000);
});
