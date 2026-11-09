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
  BUILDER_GENERATION_PROMPT_VERSION,
  type BuilderGenerationFailureV1,
  type BuilderGenerationModelGatewayPort,
} from "./builder-natural-language-generation-types.js";
import { computeBuilderProposalDigest } from "./builder-proposal-digest.js";
import { validateBuilderProposalModelOutputPipeline } from "./builder-proposal-model-output-pipeline.js";
import { BuilderProposalOpenAiJsonSchema } from "./builder-proposal-openai-json-schema.js";
import { parseBuilderProposalV1 } from "./builder-proposal-schema.js";
import {
  buildBoundedCapabilityCatalogPayloadForRefinement,
  buildBuilderRefinementMessages,
  serializeCurrentProposalForPrompt,
} from "./builder-refinement-prompt.js";
import {
  BUILDER_REFINEMENT_PROMPT_VERSION,
  DEFAULT_BUILDER_REFINEMENT_LIMITS,
  type BuilderRefinementFailureV1,
  type BuilderRefinementLimitsV1,
  type BuilderRefinementMetadataV1,
  type BuilderRefinementSuccessV1,
  type RefineBuilderProposalRequestV1,
  type RefineBuilderProposalResultV1,
  type BuilderRefinementErrorCode,
} from "./builder-refinement-types.js";
import { mergeBuilderModelUsage } from "./builder-generation-usage.js";
import {
  mapModelGatewayErrorToBuilderFailure,
  readModelGatewayErrorLike,
} from "./builder-model-gateway-diagnostics.js";
import { modelProviderSupportsStructuredJsonSchema } from "./builder-provider-structured-output.js";
import { compareBuilderProposalChanges } from "./compare-builder-proposal-changes.js";
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
  code: BuilderRefinementErrorCode,
  message: string,
  partial?: Partial<BuilderRefinementFailureV1>,
): BuilderRefinementFailureV1 {
  return {
    ok: false,
    errorCode: code,
    message,
    ...partial,
  };
}

export interface RefineBuilderProposalFromNaturalLanguageDependencies extends WorkspaceBuilderCapabilityCatalogDependencies {
  readonly modelProfiles: ModelProfileRepository;
  readonly modelGateway: BuilderGenerationModelGatewayPort;
  readonly defaultGenerationModelProfileVersionId?: ModelProfileVersionId;
  readonly limits?: Partial<BuilderRefinementLimitsV1>;
}

/**
 * M20.5 — bounded conversational refinement of an existing {@link BuilderProposalV1}.
 * Read-only aside from model inference; never publishes or executes.
 */
export class RefineBuilderProposalFromNaturalLanguage {
  private readonly getCatalog: GetWorkspaceBuilderCapabilityCatalog;
  private readonly limits: BuilderRefinementLimitsV1;

  constructor(
    private readonly deps: RefineBuilderProposalFromNaturalLanguageDependencies,
  ) {
    this.getCatalog = new GetWorkspaceBuilderCapabilityCatalog({
      workspaces: deps.workspaces,
      agents: deps.agents,
      modelProfiles: deps.modelProfiles,
      tools: deps.tools,
    });
    this.limits = { ...DEFAULT_BUILDER_REFINEMENT_LIMITS, ...deps.limits };
  }

  async execute(
    request: RefineBuilderProposalRequestV1,
  ): Promise<RefineBuilderProposalResultV1> {
    const started = nowMs();
    const workspaceId = controlPlaneWorkspaceId(request.scope);
    const deadlineMs = started + this.limits.maxTotalDurationMs;

    const checkDeadline = (): BuilderRefinementFailureV1 | undefined => {
      if (nowMs() > deadlineMs) {
        return asFailure(
          "GENERATION_DEADLINE_EXCEEDED",
          "Refinement exceeded the configured total deadline.",
        );
      }
      return undefined;
    };

    if (
      typeof request.expectedBaseProposalDigest !== "string" ||
      request.expectedBaseProposalDigest.trim().length === 0
    ) {
      return asFailure(
        "INVALID_GENERATION_REQUEST",
        "expectedBaseProposalDigest must be a non-empty string.",
      );
    }

    if (
      utf16Length(request.refinementInstruction) >
      this.limits.maxRefinementInstructionUtf16Units
    ) {
      return asFailure(
        "INVALID_GENERATION_REQUEST",
        "Refinement instruction exceeds the configured maximum length.",
      );
    }

    const history = request.conversationalHistory;
    if (history !== undefined) {
      if (history.length > this.limits.maxConversationalHistoryEntries) {
        return asFailure(
          "INVALID_GENERATION_REQUEST",
          "Too many conversational history entries.",
        );
      }
      let historyUnits = 0;
      for (const h of history) {
        if (typeof h !== "string") {
          return asFailure(
            "INVALID_GENERATION_REQUEST",
            "Conversational history entries must be strings.",
          );
        }
        historyUnits += utf16Length(h);
      }
      if (historyUnits > this.limits.maxConversationalHistoryUtf16Units) {
        return asFailure(
          "PROMPT_TOO_LARGE",
          "Conversational history exceeds size limits.",
        );
      }
    }

    const baseParse = parseBuilderProposalV1(request.currentProposal);
    if (!baseParse.ok) {
      return asFailure(
        "INVALID_BASE_PROPOSAL",
        "Current proposal failed structural validation.",
        {
          detailMessages: [...baseParse.messages],
        },
      );
    }

    const baseProposal = baseParse.proposal;
    const baseProposalDigest = computeBuilderProposalDigest(baseProposal);

    if (baseProposalDigest !== request.expectedBaseProposalDigest.trim()) {
      return asFailure(
        "STALE_BASE_PROPOSAL_DIGEST",
        "Current proposal digest does not match expectedBaseProposalDigest. Refresh the draft and retry.",
        { baseProposalDigest },
      );
    }

    const serializedBase = serializeCurrentProposalForPrompt(
      baseProposal,
      this.limits.maxCurrentProposalSerializedUtf16Units,
    );
    if (!serializedBase.ok) {
      return asFailure("CURRENT_PROPOSAL_TOO_LARGE", serializedBase.message, {
        baseProposalDigest,
      });
    }

    const genDeadline = checkDeadline();
    if (genDeadline !== undefined) {
      return genDeadline;
    }

    requireControlPlaneAuthorization(
      request.scope,
      AUTHORIZATION_ACTIONS.READ,
      AGENT_RESOURCE,
    );
    requireControlPlaneAuthorization(
      request.scope,
      AUTHORIZATION_ACTIONS.READ,
      MODEL_RESOURCE,
    );
    requireControlPlaneAuthorization(
      request.scope,
      AUTHORIZATION_ACTIONS.READ,
      TOOL_RESOURCE,
    );

    const generationId =
      request.generationModelProfileVersionId ??
      this.deps.defaultGenerationModelProfileVersionId;
    if (generationId === undefined) {
      return asFailure(
        "INVALID_GENERATION_REQUEST",
        "generationModelProfileVersionId is required when no default is configured.",
        { baseProposalDigest },
      );
    }

    const genVersion =
      await this.deps.modelProfiles.findModelProfileVersionById(generationId);
    if (genVersion === null) {
      return asFailure(
        "UNAUTHORIZED_GENERATION_MODEL",
        "Generation model profile version was not found.",
        { baseProposalDigest },
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
        { baseProposalDigest },
      );
    }

    const structured = modelProviderSupportsStructuredJsonSchema(
      genVersion.provider,
    );

    if (!structured) {
      return asFailure(
        "UNSUPPORTED_STRUCTURED_OUTPUT",
        "The selected generation model provider does not support JSON schema constrained output for this flow.",
        {
          baseProposalDigest,
          metadata: {
            promptVersion: BUILDER_GENERATION_PROMPT_VERSION,
            refinementPromptVersion: BUILDER_REFINEMENT_PROMPT_VERSION,
            generationModelProfileVersionId: generationId,
            generationProvider: genVersion.provider,
            structuredOutputMode: "downstream_validation_only",
            attempts: 0,
            elapsedMs: nowMs() - started,
            catalogAgentVersions: 0,
            catalogModelProfileVersions: 0,
            catalogToolVersions: 0,
            catalogTruncated: false,
            baseProposalDigest,
            noop: false,
          },
        },
      );
    }

    let catalogFull;
    try {
      catalogFull = await this.getCatalog.execute(request.scope);
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        return asFailure(
          "CATALOG_RETRIEVAL_FAILED",
          "Not authorized to read workspace builder capabilities.",
          { baseProposalDigest },
        );
      }
      if (error instanceof WorkspaceNotFoundError) {
        return asFailure(
          "CATALOG_RETRIEVAL_FAILED",
          "Workspace was not found.",
          { baseProposalDigest },
        );
      }
      throw error;
    }

    const boundedOrError = buildBoundedCapabilityCatalogPayloadForRefinement(
      catalogFull,
      baseProposal,
      {
        maxAgentVersions: this.limits.maxCatalogAgentVersions,
        maxModelProfileVersions: this.limits.maxCatalogModelProfileVersions,
        maxToolVersions: this.limits.maxCatalogToolVersions,
        maxSerializedUtf16Units: this.limits.maxCatalogSerializedUtf16Units,
      },
    );

    if (!("catalogJson" in boundedOrError)) {
      return asFailure("CATALOG_TOO_LARGE", boundedOrError.message, {
        baseProposalDigest,
      });
    }

    const bounded = boundedOrError;

    const messagesBase = buildBuilderRefinementMessages(
      bounded.catalogJson,
      serializedBase.json,
      request.refinementInstruction,
      history,
    );

    const totalPromptUtf16 = messagesBase.reduce(
      (acc, m) => acc + utf16Length(m.content),
      0,
    );
    if (totalPromptUtf16 > 100_000) {
      return asFailure(
        "PROMPT_TOO_LARGE",
        "Refinement prompt exceeds internal size limits.",
        { baseProposalDigest },
      );
    }

    const catalogIndex = buildBuilderCatalogIndex(catalogFull);

    let attempts = 0;
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
      | BuilderRefinementFailureV1
    > => {
      const dl = checkDeadline();
      if (dl !== undefined) {
        return dl;
      }

      if (attempts >= this.limits.maxProviderInvocations) {
        return asFailure(
          "TOKEN_OR_OUTPUT_BUDGET_EXCEEDED",
          "Maximum provider invocations exceeded.",
          { baseProposalDigest },
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
        if (error instanceof Error && error.name === "AbortError") {
          return asFailure(
            "GENERATION_DEADLINE_EXCEEDED",
            "Refinement was cancelled due to deadline or timeout.",
            { baseProposalDigest },
          );
        }

        const gatewayError = readModelGatewayErrorLike(error);
        if (gatewayError !== undefined) {
          return {
            ...mapModelGatewayErrorToBuilderFailure(gatewayError),
            baseProposalDigest,
          };
        }

        throw error;
      } finally {
        clearTimeout(timeout);
      }
    };

    const first = await runCompletion(messagesBase);
    if (!("ok" in first) || first.ok !== true) {
      return enrichFailure(first as BuilderRefinementFailureV1, {
        genVersion,
        bounded,
        started,
        attempts,
        structured,
        generationId,
        baseProposalDigest,
        measuredUsage,
      });
    }

    let pipeline = validateBuilderProposalModelOutputPipeline(
      first.text,
      catalogIndex,
      bounded.promptVisible,
    );

    if (
      pipeline.kind === "hard_fail" &&
      pipeline.canRepair &&
      attempts < this.limits.maxProviderInvocations
    ) {
      const repairMessages: GenerateCompletionRequest["messages"] = [
        ...messagesBase,
        { role: "assistant", content: first.text ?? "" },
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
        return enrichFailure(second as BuilderRefinementFailureV1, {
          genVersion,
          bounded,
          started,
          attempts,
          structured,
          generationId,
          baseProposalDigest,
          measuredUsage,
        });
      }

      pipeline = validateBuilderProposalModelOutputPipeline(
        second.text,
        catalogIndex,
        bounded.promptVisible,
      );
    }

    if (pipeline.kind !== "success") {
      return enrichFailure(pipeline.failure as BuilderRefinementFailureV1, {
        genVersion,
        bounded,
        started,
        attempts,
        structured,
        generationId,
        baseProposalDigest,
        measuredUsage,
      });
    }

    const candidate = pipeline.proposal;
    const candidateProposalDigest = computeBuilderProposalDigest(candidate);
    const changes = compareBuilderProposalChanges(baseProposal, candidate);

    const meta: BuilderRefinementMetadataV1 = {
      promptVersion: BUILDER_GENERATION_PROMPT_VERSION,
      refinementPromptVersion: BUILDER_REFINEMENT_PROMPT_VERSION,
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
      baseProposalDigest,
      candidateProposalDigest,
      noop: changes.noop,
      measuredUsage,
    };

    const success: BuilderRefinementSuccessV1 = {
      ok: true,
      baseProposalDigest,
      candidateProposal: candidate,
      candidateProposalDigest,
      changes,
      compileIssues: pipeline.compile.issues,
      previewLogicalWorkflowDigest:
        pipeline.compile.previewLogicalWorkflowDigest,
      assumptions: candidate.assumptions,
      unresolvedRequirements: candidate.unresolvedRequirements,
      metadata: meta,
    };

    return success;
  }
}

function enrichFailure(
  failure: BuilderRefinementFailureV1 | BuilderGenerationFailureV1,
  ctx: {
    readonly genVersion: ModelProfileVersion;
    readonly bounded: {
      readonly included: {
        readonly agentVersions: number;
        readonly modelProfileVersions: number;
        readonly toolVersions: number;
      };
      readonly truncated: boolean;
    };
    readonly started: number;
    readonly attempts: number;
    readonly structured: boolean;
    readonly generationId: ModelProfileVersionId;
    readonly baseProposalDigest: string;
    readonly measuredUsage?: import("./builder-natural-language-generation-types.js").BuilderGenerationMeasuredUsageV1;
  },
): BuilderRefinementFailureV1 {
  return {
    ...failure,
    errorCode: failure.errorCode as BuilderRefinementErrorCode,
    baseProposalDigest: ctx.baseProposalDigest,
    metadata: {
      ...failure.metadata,
      promptVersion: BUILDER_GENERATION_PROMPT_VERSION,
      refinementPromptVersion: BUILDER_REFINEMENT_PROMPT_VERSION,
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
      baseProposalDigest: ctx.baseProposalDigest,
      noop: false,
      measuredUsage: ctx.measuredUsage,
    },
  };
}
