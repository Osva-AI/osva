import { describe, expect, it } from "vitest";

import { buildAgentStudioReviewBlockers } from "../src/client/lib/agent-studio-v2-review-blockers";
import { describeDeclarativeManifestValidation } from "../src/client/lib/declarative-agent-manifest";

describe("agent studio review blockers", () => {
  it("lists missing model as a publish blocker", () => {
    const validation = describeDeclarativeManifestValidation({
      schemaVersion: "1",
      key: "bot",
      name: "Bot",
      runtime: {
        type: "DECLARATIVE",
        config: {
          configVersion: "1",
          instructions: "Help users.",
          modelBinding: "primary",
          allowedToolBindings: [],
          maxModelInvocations: 4,
          maxToolInvocations: 0,
        },
      },
      input: { schema: { type: "object" } },
      output: { schema: { type: "object" } },
      execution: { timeoutMs: 30_000, maxAttempts: 1 },
      capabilities: { model: false, tools: [] },
    });
    const blockers = buildAgentStudioReviewBlockers({
      validation,
      modelProfileVersionId: "",
      instructions: "Help users.",
      agentName: "Bot",
    });
    expect(blockers.some((entry) => entry.id === "model")).toBe(true);
  });
});
