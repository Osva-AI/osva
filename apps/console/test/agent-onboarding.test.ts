import { describe, expect, it } from "vitest";

import { helloAgentManifestTemplate } from "../src/client/lib/agent-example";
import { describeManifestSubmitBlocker } from "../src/client/lib/agent-manifest-draft";
import {
  firstAgentOnboardingSteps,
  onboardingSearch,
  parseOnboardingContext,
} from "../src/client/lib/agent-onboarding";
import { buildRuntimeReadiness } from "../src/client/lib/agent-readiness";
import { parseBuilderHandoff } from "../src/client/lib/builder-handoff";
import {
  describeAgentRunInputSyntax,
  resolveAgentVersionInputContract,
} from "../src/client/lib/agent-input-contract";

describe("agent onboarding helpers", () => {
  it("keeps navigation context as non-secret identifiers", () => {
    const context = parseOnboardingContext(
      new URLSearchParams("agentId=agent-1&agentVersionId=av-1&runId=run-1"),
    );
    expect(context).toEqual({
      agentId: "agent-1",
      agentVersionId: "av-1",
      runId: "run-1",
    });
    expect(onboardingSearch(context)).toBe(
      "?agentId=agent-1&agentVersionId=av-1&runId=run-1",
    );
    const encoded = JSON.stringify(firstAgentOnboardingSteps(context));
    expect(encoded).not.toMatch(/osva_ak_|Bearer |password|secret/i);
  });

  it("does not mark the worker verified from Console reachability", () => {
    const items = buildRuntimeReadiness({
      controlPlaneReachable: true,
      selectedVersion: {
        id: "av-1",
        agentId: "agent-1",
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        manifest: {
          runtime: {
            type: "CONTAINER",
            image: `example@sha256:${"a".repeat(64)}`,
          },
          capabilities: { model: true, tools: ["search"] },
        },
      },
    });
    expect(items.find((item) => item.id === "control-plane")?.state).toBe(
      "verified_ready",
    );
    expect(items.find((item) => item.id === "worker")?.state).toBe(
      "not_verified",
    );
    expect(items.find((item) => item.id === "runtime-adapter")?.state).toBe(
      "not_verified",
    );
    expect(items.find((item) => item.id === "runtime-adapter")?.detail).toMatch(
      /not evidence the image exists/,
    );
    expect(items.find((item) => item.id === "model-provider")?.state).toBe(
      "requires_setup",
    );
  });

  it("resolves the selected version input contract without inventing fields", () => {
    const contract = resolveAgentVersionInputContract("agent-1", "av-1", {
      id: "av-1",
      agentId: "agent-1",
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
      manifest: { input: { schema: { type: "object" } } },
    });
    expect(contract).toMatchObject({
      status: "available",
      agentVersionId: "av-1",
      schema: { type: "object" },
    });
    expect(
      describeAgentRunInputSyntax({ ok: true, value: {} }, contract).message,
    ).toMatch(/does not mean this AgentVersion will accept/);
  });

  it("does not embed executable agent source in the example template", () => {
    const template = JSON.stringify(helloAgentManifestTemplate());
    expect(template).toContain("TRUSTED_TYPESCRIPT");
    expect(template).toContain("sha256:<hex-digest-of-hello-agent.ts>");
    expect(template).toContain("hello-agent.ts");
    expect(template).not.toContain("export async function run");
    expect(template).not.toContain("OPENAI_API_KEY");
    expect(
      describeManifestSubmitBlocker(
        JSON.stringify(helloAgentManifestTemplate()),
      ),
    ).toMatch(/sha256:<64 hex chars>/);
  });

  it("parses builder handoff ids from the query string", () => {
    expect(
      parseBuilderHandoff(
        new URLSearchParams("agentId=agent-1&agentVersionId=av-1"),
      ),
    ).toEqual({ agentId: "agent-1", agentVersionId: "av-1" });
  });
});
