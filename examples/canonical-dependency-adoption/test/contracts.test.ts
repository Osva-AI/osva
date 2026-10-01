import { describe, expect, it } from "vitest";

import {
  validAnalysisOutput,
  validReportOutput,
  validResearchOutput,
  validWorkflowInput,
} from "./fixtures.js";
import {
  assertInvalid,
  assertValid,
  validateAnalysisOutput,
  validateReportOutput,
  validateResearchOutput,
  validateWorkflowInput,
} from "./schema-validate.js";

describe("canonical example JSON contracts", () => {
  it("accepts valid workflow input, research, analysis, and report fixtures", () => {
    assertValid(validateWorkflowInput, validWorkflowInput, "workflow input");
    assertValid(validateResearchOutput, validResearchOutput, "research output");
    assertValid(validateAnalysisOutput, validAnalysisOutput, "analysis output");
    assertValid(validateReportOutput, validReportOutput, "report output");
  });

  it("requires research output to preserve the request envelope", () => {
    expect(validResearchOutput.request).toEqual(validWorkflowInput.request);
    assertValid(validateResearchOutput, validResearchOutput, "research output");
  });

  it("requires analysis output to preserve the request envelope", () => {
    expect(validAnalysisOutput.request).toEqual(validWorkflowInput.request);
    assertValid(validateAnalysisOutput, validAnalysisOutput, "analysis output");
  });

  it("rejects invalid analysis disposition values", () => {
    const invalid = {
      ...validAnalysisOutput,
      analysis: {
        ...validAnalysisOutput.analysis,
        disposition: "MAYBE",
      },
    };
    expect(assertInvalid(validateAnalysisOutput, invalid)).toBe(true);
  });

  it("rejects workflow input missing requestId", () => {
    const invalid = {
      schemaVersion: "1",
      request: {
        packageName: "zod",
        useCase: "test",
        constraints: [],
      },
    };
    expect(assertInvalid(validateWorkflowInput, invalid)).toBe(true);
  });

  it("rejects report artifact references whose type is not artifact", () => {
    const invalid = {
      ...validReportOutput,
      artifact: {
        type: "file",
        artifactId: "artifact-canonical-report-001",
      },
    };
    expect(assertInvalid(validateReportOutput, invalid)).toBe(true);
  });
});
