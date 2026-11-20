import type { ModelProfileVersionId } from "@osva-ai/contracts";
import { MODEL_ERROR_CODES } from "@osva-ai/contracts";
import { MemoryModelProfileRepository } from "@osva/adapters-memory";
import { describe, expect, it, vi } from "vitest";

import { BudgetEnforcingModelGateway } from "../src/budget-enforcing-model-gateway.js";

describe("BudgetEnforcingModelGateway fail-closed", () => {
  it("S6/S7: rejects provider I/O when budget context is FAIL_CLOSED", async () => {
    const inner = {
      generateTextOutcome: vi.fn(async () => ({ text: "bypass" })),
    };
    const gateway = new BudgetEnforcingModelGateway({
      inner: inner as never,
      modelProfiles: new MemoryModelProfileRepository(),
      admission: {} as never,
    });
    await expect(
      gateway.generateTextOutcome(
        {
          modelProfileVersionId: "mpv" as ModelProfileVersionId,
          messages: [{ role: "user", content: "hi" }],
        },
        {
          budget: { enforcement: "FAIL_CLOSED" },
        },
      ),
    ).rejects.toMatchObject({
      code: MODEL_ERROR_CODES.MODEL_INFERENCE_BUDGET_UNAVAILABLE,
    });
    expect(inner.generateTextOutcome).not.toHaveBeenCalled();
  });
});
