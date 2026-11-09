import type {
  GenerateCompletionRequest,
  ModelProfileVersionId,
} from "@osva-ai/contracts";
import { AUTHORIZATION_ACTIONS } from "@osva-ai/contracts";

import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
} from "../control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "../control-plane-resource-kinds.js";
import type { ModelProfileRepository } from "../ports/model-profile-repository.js";
import { PermissionDeniedError } from "../security-errors.js";
import { WorkspaceNotFoundError } from "../errors.js";
import type { ModelProfileVersion } from "../model-profile-version.js";

import { buildBuilderCatalogIndex } from "./builder-compiler.js";
import {
  buildGenerationAttemptDiagnostic,
  type BuilderGenerationAttemptDiagnosticV1,
} from "./builder-generation-attempt-diagnostics.js";
import { validateBuilderProposalModelOutputPipeline } from "./builder-proposal-model-output-pipeline.js";
import {
  BUILDER_GENERATION_PROMPT_VERSION,
  type BuilderGenerationErrorCode,
  type BuilderGenerationFailureV1,
  type BuilderGenerationLimitsV1,
  type BuilderGenerationMetadataV1,
  type BuilderGenerationSuccessV1,
  type BuilderGenerationModelGatewayPort,
  DEFAULT_BUILDER_GENERATION_LIMITS,
  type GenerateBuilderProposalRequestV1,
  type GenerateBuilderProposalResultV1,
} from "./builder-natural-language-generation-types.js";
import {
  buildBoundedCapabilityCatalogPayload,
  buildBuilderGenerationMessages,
} from "./builder-natural-language-prompt.js";
import { BuilderProposalOpenAiJsonSchema } from "./builder-proposal-openai-json-schema.js";
import { mergeBuilderModelUsage } from "./builder-generation-usage.js";
import {
  mapModelGatewayErrorToBuilderFailure,
  readModelGatewayErrorLike,
} from "./builder-model-gateway-diagnostics.js";
import { modelProviderSupportsStructuredJsonSchema } from "./builder-provider-structured-output.js";
import {
  GetWorkspaceBuilderCapabilityCatalog,
  type WorkspaceBuilderCapabilityCatalogDependencies,
} from "./workspace-builder-capability-catalog.js";

const AGENT_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.agent };
const MODEL_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.modelProfile };
const TOOL_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.tool };

function utf16Length(s: string): number {
  return s.length;
}

function nowMs(): number {
  return Date.now();
}

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

export interface GenerateBuilderProposalFromNaturalLanguageDependencies extends WorkspaceBuilderCapabilityCatalogDependencies {
  readonly modelProfiles: ModelProfileRepository;
  readonly modelGateway: BuilderGenerationModelGatewayPort;
  /**
   * When {@link GenerateBuilderProposalRequestV1.generationModelProfileVersionId} is omitted,
   * this default must be set and authorized for the workspace.
   */
  readonly defaultGenerationModelProfileVersionId?: ModelProfileVersionId;
  readonly limits?: Partial<BuilderGenerationLimitsV1>;
}

/**
 * M20.2 — bounded natural-language generation of {@link BuilderProposalV1} via ModelGateway.
 * Read-only: no publication, execution, or side effects beyond model inference.
 */
export class GenerateBuilderProposalFromNaturalLanguage {
  private readonly getCatalog: GetWorkspaceBuilderCapabilityCatalog;
  private readonly limits: BuilderGenerationLimitsV1;

  constructor(
    private readonly deps: GenerateBuilderProposalFromNaturalLanguageDependencies,
  ) {
    this.getCatalog = new GetWorkspaceBuilderCapabilityCatalog({
      workspaces: deps.workspaces,
      agents: deps.agents,
      modelProfiles: deps.modelProfiles,
      tools: deps.tools,
    });
    this.limits = { ...DEFAULT_BUILDER_GENERATION_LIMITS, ...deps.limits };
  }

  async execute(
    request: GenerateBuilderProposalRequestV1,
  ): Promise<GenerateBuilderProposalResultV1> {
    const started = nowMs();
    const scope = request.scope;
    const workspaceId = controlPlaneWorkspaceId(scope);

    const deadlineMs = started + this.limits.maxTotalDurationMs;

    const checkDeadline = (): BuilderGenerationFailureV1 | undefined => {
      if (nowMs() > deadlineMs) {
        return asFailure(
          "GENERATION_DEADLINE_EXCEEDED",
          "Generation exceeded the configured total deadline.",
        );
      }

      return undefined;
    };

    if (
      utf16Length(request.userInstruction) >
      this.limits.maxUserInstructionUtf16Units
    ) {
      return asFailure(
        "INVALID_GENERATION_REQUEST",
        "User instruction exceeds the configured maximum length.",
      );
    }

    const genDeadline = checkDeadline();
    if (genDeadline !== undefined) {
      return genDeadline;
    }

    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      AGENT_RESOURCE,
    );
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      MODEL_RESOURCE,
    );
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      TOOL_RESOURCE,
    );

    const prefs = request.preferences?.preferredExecutionModelProfileVersionIds;
    if (prefs !== undefined) {
      if (prefs.length > 32) {
        return asFailure(
          "INVALID_GENERATION_REQUEST",
          "Too many preferred execution model profile versions.",
        );
      }

      const seen = new Set<string>();
      for (const id of prefs) {
        if (seen.has(String(id))) {
          return asFailure(
            "INVALID_GENERATION_REQUEST",
            "Duplicate preferred execution model profile version id.",
          );
        }

        seen.add(String(id));
      }
    }

    const generationId =
      request.generationModelProfileVersionId ??
      this.deps.defaultGenerationModelProfileVersionId;
    if (generationId === undefined) {
      return asFailure(
        "INVALID_GENERATION_REQUEST",
        "generationModelProfileVersionId is required when no default is configured.",
      );
    }

    const genVersion =
      await this.deps.modelProfiles.findModelProfileVersionById(generationId);
    if (genVersion === null) {
      return asFailure(
        "UNAUTHORIZED_GENERATION_MODEL",
        "Generation model profile version was not found.",
      );
    }

    const owningProfile =
      await this.deps.modelProfiles.findModelProfileByWorkspaceAndId(
        workspaceId,
        genVersion.modelProfileId,
      );
    if (owningProfile === null) {
      return asFailure(
        "UNAUTHORIZED_GENERATION_MODEL",
        "Generation model profile version is not authorized for this workspace.",
      );
    }

    const structured = modelProviderSupportsStructuredJsonSchema(
      genVersion.provider,
    );

    if (!structured) {
      return asFailure(
        "UNSUPPORTED_STRUCTURED_OUTPUT",
        "The selected generation model provider does not support JSON schema constrained output for this flow; choose an OpenAI or Gemini generation profile.",
        {
          metadata: {
            promptVersion: BUILDER_GENERATION_PROMPT_VERSION,
            generationModelProfileVersionId: generationId,
            generationProvider: genVersion.provider,
            structuredOutputMode: "downstream_validation_only",
            attempts: 0,
            elapsedMs: nowMs() - started,
            catalogAgentVersions: 0,
            catalogModelProfileVersions: 0,
            catalogToolVersions: 0,
            catalogTruncated: false,
          },
        },
      );
    }

    let catalogFull;
    try {
      catalogFull = await this.getCatalog.execute(scope);
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        return asFailure(
          "CATALOG_RETRIEVAL_FAILED",
          "Not authorized to read workspace builder capabilities.",
        );
      }

      if (error instanceof WorkspaceNotFoundError) {
        return asFailure(
          "CATALOG_RETRIEVAL_FAILED",
          "Workspace was not found.",
        );
      }

      throw error;
    }

    const bounded = buildBoundedCapabilityCatalogPayload(catalogFull, {
      maxAgentVersions: this.limits.maxCatalogAgentVersions,
      maxModelProfileVersions: this.limits.maxCatalogModelProfileVersions,
      maxToolVersions: this.limits.maxCatalogToolVersions,
      maxSerializedUtf16Units: this.limits.maxCatalogSerializedUtf16Units,
    });

    if (bounded.utf16Units > this.limits.maxCatalogSerializedUtf16Units) {
      return asFailure(
        "CATALOG_TOO_LARGE",
        "Workspace capability catalog exceeds serialized size limits after bounding.",
      );
    }

    const catalogIndex = buildBuilderCatalogIndex(catalogFull);
    const preferred = prefs?.filter((id) =>
      catalogIndex.modelProfileVersionsById.has(id),
    );

    const instructionSegments: string[] = [request.userInstruction];
    if (preferred !== undefined && preferred.length > 0) {
      instructionSegments.push(
        `Preferred execution model profile version ids (must use only if listed in catalog): ${preferred
          .slice()
          .sort((a, b) => String(a).localeCompare(String(b)))
          .join(", ")}.`,
      );
    }

    const combinedInstruction = instructionSegments.join("\n\n");
    if (
      utf16Length(combinedInstruction) >
      this.limits.maxUserInstructionUtf16Units
    ) {
      return asFailure(
        "PROMPT_TOO_LARGE",
        "Combined instruction payload exceeds the configured maximum length.",
      );
    }

    const messagesBase = buildBuilderGenerationMessages(
      bounded.catalogJson,
      combinedInstruction,
    );

    const totalPromptUtf16 =
      utf16Length(messagesBase[0]!.content) +
      utf16Length(messagesBase[1]!.content) +
      utf16Length(messagesBase[2]!.content);
    if (totalPromptUtf16 > 100_000) {
      return asFailure(
        "PROMPT_TOO_LARGE",
        "Generation prompt exceeds internal size limits.",
      );
    }

    let attempts = 0;
    const attemptDiagnostics: BuilderGenerationAttemptDiagnosticV1[] = [];
    let measuredUsage = undefined as
      | import("./builder-natural-language-generation-types.js").BuilderGenerationMeasuredUsageV1
      | undefined;
    let lastFinishReason = undefined as
      import("@osva-ai/contracts").ModelFinishReason | undefined;

    const runCompletion = async (
      messages: GenerateCompletionRequest["messages"],
    ): Promise<
      | {
          ok: true;
          text: string | undefined;
          finishReason: typeof lastFinishReason;
        }
      | BuilderGenerationFailureV1
    > => {
      const dl = checkDeadline();
      if (dl !== undefined) {
        return dl;
      }

      if (attempts >= this.limits.maxProviderInvocations) {
        return asFailure(
          "TOKEN_OR_OUTPUT_BUDGET_EXCEEDED",
          "Maximum provider invocations exceeded.",
        );
      }

      attempts += 1;

      const controller = new AbortController();
      const timeLeft = deadlineMs - nowMs();
      const timeout = setTimeout(
        () => {
          controller.abort();
        },
        Math.max(1, timeLeft),
      );

      try {
        const req: GenerateCompletionRequest = {
          modelProfileVersionId: generationId,
          messages,
          maxOutputTokens: this.limits.maxOutputTokensPerAttempt,
          jsonSchema: BuilderProposalOpenAiJsonSchema,
        };

        const result = await this.deps.modelGateway.generateCompletion(req, {
          signal: controller.signal,
        });
        lastFinishReason = result.finishReason;
        measuredUsage = mergeBuilderModelUsage(measuredUsage, result.usage);
        return {
          ok: true,
          text: result.text,
          finishReason: result.finishReason,
        };
      } catch (error) {
        clearTimeout(timeout);
        if (error instanceof Error && error.name === "AbortError") {
          return asFailure(
            "GENERATION_DEADLINE_EXCEEDED",
            "Generation was cancelled due to deadline or timeout.",
          );
        }

        const gatewayError = readModelGatewayErrorLike(error);
        if (gatewayError !== undefined) {
          return mapModelGatewayErrorToBuilderFailure(gatewayError);
        }

        throw error;
      } finally {
        clearTimeout(timeout);
      }
    };

    const recordPipelineOutcome = (
      providerAttempt: number,
      afterRepair: boolean,
      repairAttempted: boolean,
      pipeline: ReturnType<typeof validateBuilderProposalModelOutputPipeline>,
      finishReason?: import("@osva-ai/contracts").ModelFinishReason,
    ): void => {
      if (pipeline.kind === "hard_fail") {
        attemptDiagnostics.push(
          buildGenerationAttemptDiagnostic({
            providerAttempt,
            afterRepair,
            repairAttempted,
            failure: pipeline.failure,
            modelFinishReason: finishReason,
            measuredUsage,
          }),
        );
      }
    };

    const first = await runCompletion(messagesBase);
    if (!("ok" in first) || first.ok !== true) {
      attemptDiagnostics.push(
        buildGenerationAttemptDiagnostic({
          providerAttempt: attempts,
          afterRepair: false,
          repairAttempted: false,
          failure: first as BuilderGenerationFailureV1,
          measuredUsage,
        }),
      );
      return enrichFailure(first as BuilderGenerationFailureV1, {
        genVersion,
        bounded,
        started,
        attempts,
        structured,
        generationId,
        measuredUsage,
        attemptDiagnostics,
      });
    }

    let pipeline = validateBuilderProposalModelOutputPipeline(
      first.text,
      catalogIndex,
      bounded.promptVisible,
    );
    recordPipelineOutcome(1, false, false, pipeline, first.finishReason);

    if (
      pipeline.kind === "hard_fail" &&
      pipeline.canRepair &&
      attempts < this.limits.maxProviderInvocations
    ) {
      const repairMessages: GenerateCompletionRequest["messages"] = [
        ...messagesBase,
        {
          role: "assistant",
          content: first.text ?? "",
        },
        {
          role: "user",
          content: `=== VALIDATION_FAILURE ===
${pipeline.repairHint}
Return ONLY the corrected JSON object for BuilderProposalV1 with schemaVersion "1".
=== END_VALIDATION_FAILURE ===`,
        },
      ];

      const second = await runCompletion(repairMessages);
      if (!("ok" in second) || second.ok !== true) {
        attemptDiagnostics.push(
          buildGenerationAttemptDiagnostic({
            providerAttempt: attempts,
            afterRepair: true,
            repairAttempted: true,
            failure: second as BuilderGenerationFailureV1,
            measuredUsage,
          }),
        );
        return enrichFailure(second as BuilderGenerationFailureV1, {
          genVersion,
          bounded,
          started,
          attempts,
          structured,
          generationId,
          measuredUsage,
          attemptDiagnostics,
        });
      }

      pipeline = validateBuilderProposalModelOutputPipeline(
        second.text,
        catalogIndex,
        bounded.promptVisible,
      );
      recordPipelineOutcome(2, true, true, pipeline, second.finishReason);
    }

    if (pipeline.kind !== "success") {
      return enrichFailure(pipeline.failure, {
        genVersion,
        bounded,
        started,
        attempts,
        structured,
        generationId,
        measuredUsage,
        attemptDiagnostics,
      });
    }

    const meta: BuilderGenerationMetadataV1 = {
      promptVersion: BUILDER_GENERATION_PROMPT_VERSION,
      generationModelProfileVersionId: generationId,
      generationProvider: genVersion.provider,
      structuredOutputMode: "provider_json_schema",
      modelFinishReason: lastFinishReason,
      attempts,
      elapsedMs: nowMs() - started,
      catalogAgentVersions: bounded.included.agentVersions,
      catalogModelProfileVersions: bounded.included.modelProfileVersions,
      catalogToolVersions: bounded.included.toolVersions,
      catalogTruncated: bounded.truncated,
      measuredUsage,
    };

    const success: BuilderGenerationSuccessV1 = {
      ok: true,
      proposal: pipeline.proposal,
      compileIssues: pipeline.compile.issues,
      previewLogicalWorkflowDigest:
        pipeline.compile.previewLogicalWorkflowDigest,
      assumptions: pipeline.proposal.assumptions,
      unresolvedRequirements: pipeline.proposal.unresolvedRequirements,
      metadata: meta,
    };

    return success;
  }
}

function enrichFailure(
  failure: BuilderGenerationFailureV1,
  ctx: {
    readonly genVersion: ModelProfileVersion;
    readonly bounded: ReturnType<typeof buildBoundedCapabilityCatalogPayload>;
    readonly started: number;
    readonly attempts: number;
    readonly structured: boolean;
    readonly generationId: ModelProfileVersionId;
    readonly measuredUsage?: import("./builder-natural-language-generation-types.js").BuilderGenerationMeasuredUsageV1;
    readonly attemptDiagnostics?: readonly BuilderGenerationAttemptDiagnosticV1[];
  },
): BuilderGenerationFailureV1 {
  return {
    ...failure,
    metadata: {
      ...failure.metadata,
      promptVersion: BUILDER_GENERATION_PROMPT_VERSION,
      generationModelProfileVersionId: ctx.generationId,
      generationProvider: ctx.genVersion.provider,
      structuredOutputMode: ctx.structured
        ? "provider_json_schema"
        : "downstream_validation_only",
      attempts: ctx.attempts,
      elapsedMs: nowMs() - ctx.started,
      catalogAgentVersions: ctx.bounded.included.agentVersions,
      catalogModelProfileVersions: ctx.bounded.included.modelProfileVersions,
      catalogToolVersions: ctx.bounded.included.toolVersions,
      catalogTruncated: ctx.bounded.truncated,
      measuredUsage: ctx.measuredUsage,
      ...(ctx.attemptDiagnostics !== undefined &&
      ctx.attemptDiagnostics.length > 0
        ? { attemptDiagnostics: ctx.attemptDiagnostics }
        : {}),
    },
  };
}
