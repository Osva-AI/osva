import type { BuilderPrePublicationCompileResultV1 } from "./builder-compiler.js";
import { compileBuilderProposalPrePublication } from "./builder-compiler.js";
import type { BuilderCatalogIndexV1 } from "./builder-compiler.js";
import { extractSingleJsonObject } from "./builder-generation-json-extract.js";
import { validateProposalResourcePromptVisibility } from "./builder-generation-prompt-visibility.js";
import type {
  BuilderGenerationErrorCode,
  BuilderGenerationFailureV1,
} from "./builder-natural-language-generation-types.js";
import type { BuilderProposalV1 } from "./builder-proposal.js";
import { parseBuilderProposalV1 } from "./builder-proposal-schema.js";
import type { BoundedCapabilityCatalogResult } from "./builder-natural-language-prompt.js";

type SuccessfulCompile = BuilderPrePublicationCompileResultV1 & { ok: true };

export type BuilderProposalModelOutputPipelineResult =
  | {
      kind: "success";
      proposal: BuilderProposalV1;
      compile: SuccessfulCompile;
    }
  | {
      kind: "hard_fail";
      failure: BuilderGenerationFailureV1;
      canRepair: boolean;
      repairHint: string;
    };

function asFailure(
  code: BuilderGenerationErrorCode,
  message: string,
  partial?: Partial<BuilderGenerationFailureV1>,
): BuilderGenerationFailureV1 {
  return {
    ok: false,
    errorCode: code,
    message,
    ...partial,
  };
}

export function validateBuilderProposalModelOutputPipeline(
  text: string | undefined,
  catalogIndex: BuilderCatalogIndexV1,
  promptVisible: BoundedCapabilityCatalogResult["promptVisible"],
): BuilderProposalModelOutputPipelineResult {
  if (text === undefined || text.trim().length === 0) {
    return {
      kind: "hard_fail",
      canRepair: true,
      repairHint:
        "- Model returned empty text.\n- Emit a single JSON object for BuilderProposalV1.",
      failure: asFailure(
        "INVALID_JSON_OUTPUT",
        "Model returned no textual output.",
      ),
    };
  }

  const extract = extractSingleJsonObject(text);
  if (!extract.ok) {
    const reasonMap: Record<string, string> = {
      empty: "empty output",
      no_object: "no JSON object found",
      trailing_content: "extra content after JSON object or multiple roots",
      unclosed_or_invalid: "invalid or incomplete JSON object",
    };
    return {
      kind: "hard_fail",
      canRepair: true,
      repairHint: `- JSON extraction failed (${reasonMap[extract.reason] ?? extract.reason}).\n- Return exactly one JSON object.`,
      failure: asFailure(
        "INVALID_JSON_OUTPUT",
        "Could not extract a single JSON object from model output.",
        { detailMessages: [reasonMap[extract.reason] ?? extract.reason] },
      ),
    };
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(extract.json) as unknown;
  } catch {
    return {
      kind: "hard_fail",
      canRepair: true,
      repairHint: "- JSON.parse failed.\n- Return syntactically valid JSON.",
      failure: asFailure(
        "INVALID_JSON_OUTPUT",
        "JSON.parse failed for extracted object.",
      ),
    };
  }

  const proposalParse = parseBuilderProposalV1(parsedUnknown);
  if (!proposalParse.ok) {
    return {
      kind: "hard_fail",
      canRepair: true,
      repairHint: `- BuilderProposalV1 parse errors:\n${proposalParse.messages
        .map((m) => `  - ${m}`)
        .join("\n")}`,
      failure: asFailure(
        "INVALID_BUILDER_PROPOSAL",
        "Proposal failed structural validation.",
        { detailMessages: [...proposalParse.messages] },
      ),
    };
  }

  const visibility = validateProposalResourcePromptVisibility(
    proposalParse.proposal,
    promptVisible,
    catalogIndex,
  );
  if (!visibility.ok) {
    return {
      kind: "hard_fail",
      canRepair: true,
      repairHint: `- ${visibility.message}\n- Only reference resource ids listed in the CAPABILITY_CATALOG_JSON block.`,
      failure: asFailure(
        "CATALOG_PROMPT_VISIBILITY_VIOLATION",
        visibility.message,
      ),
    };
  }

  const compiled = compileBuilderProposalPrePublication(
    proposalParse.proposal,
    catalogIndex,
  );

  if (!compiled.ok) {
    const unauthorized = compiled.issues.some(
      (i) => i.code === "UNAUTHORIZED_OR_FOREIGN_RESOURCE",
    );
    const missingModel = compiled.issues.some(
      (i) => i.code === "MISSING_MODEL_SELECTION",
    );
    const missingTool = compiled.issues.some(
      (i) => i.code === "MISSING_TOOL_SELECTION",
    );

    const code: BuilderGenerationErrorCode =
      unauthorized || missingModel || missingTool
        ? "UNAUTHORIZED_OR_UNKNOWN_RESOURCE_REFERENCE"
        : "INVALID_COMPILED_PROPOSAL";

    return {
      kind: "hard_fail",
      canRepair: true,
      repairHint: `- Pre-publication compilation failed:\n${compiled.issues
        .map((i) => `  - ${i.code}: ${i.message}`)
        .join("\n")}`,
      failure: asFailure(
        code,
        "Proposal did not pass workspace catalog and compiler checks.",
        { compileIssues: compiled.issues },
      ),
    };
  }

  return {
    kind: "success",
    proposal: compiled.proposal ?? proposalParse.proposal,
    compile: compiled as SuccessfulCompile,
  };
}
