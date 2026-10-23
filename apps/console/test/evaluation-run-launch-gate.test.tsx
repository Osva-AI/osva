import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EvaluationQualityGateRulesEditor } from "../src/client/components/evaluation/evaluation-quality-gate-rules-editor";
import { validateQualityGateRuleDrafts } from "../src/client/lib/evaluation-quality-gate-config";

describe("EvaluationQualityGateRulesEditor", () => {
  it("starts disabled without rules", () => {
    render(
      <EvaluationQualityGateRulesEditor
        enabled={false}
        rules={[]}
        issues={[]}
        onEnabledChange={vi.fn()}
        onRulesChange={vi.fn()}
      />,
    );
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(
      false,
    );
    expect(screen.queryByLabelText(/Minimum threshold/)).toBeNull();
  });

  it("validates duplicate metrics through shared draft validation", () => {
    const issues = validateQualityGateRuleDrafts(true, [
      {
        localId: "a",
        metric: "PASS_RATE",
        thresholdDisplay: "90",
      },
      {
        localId: "b",
        metric: "PASS_RATE",
        thresholdDisplay: "80",
      },
    ]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("allows entering a threshold and removing a rule", async () => {
    const user = userEvent.setup();
    const onRulesChange = vi.fn();
    render(
      <EvaluationQualityGateRulesEditor
        enabled
        rules={[
          {
            localId: "rule-1",
            metric: "PASS_RATE",
            thresholdDisplay: "",
          },
        ]}
        issues={[]}
        onEnabledChange={vi.fn()}
        onRulesChange={onRulesChange}
      />,
    );

    const threshold = screen.getByLabelText(/Minimum threshold/);
    await user.type(threshold, "85");
    expect(onRulesChange).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Remove rule" }));
    expect(onRulesChange).toHaveBeenCalled();
  });
});
