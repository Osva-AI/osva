import type { IncomingMessage, ServerResponse } from "node:http";
import type { ModelProfileVersionId } from "@osva-ai/contracts";
import {
  BuilderPublicationNotFoundError,
  BuilderPublicationNotPublishableError,
} from "@osva/domain";
import {
  GenerateBuilderProposalFromNaturalLanguage,
  GetBuilderPublicationReceipt,
  GetWorkspaceBuilderCapabilityCatalog,
  PrepareBuilderPublication,
  PublishBuilderProposal,
  buildBuilderCatalogIndex,
  compileBuilderProposalPrePublication,
  type BuilderPublicationId,
  type GenerateBuilderProposalResultV1,
} from "@osva/domain/builder";

import { requireControlPlaneScope } from "./control-plane-http.js";
import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";

const JSON_BODY_MAX_BYTES = 256 * 1024;

/** Must exceed M20.2 default builder generation wall-clock budget (120_000 ms). */
export const BUILDER_GENERATION_REQUEST_TIMEOUT_MS = 150_000;

export interface BuilderHttpServices {
  readonly generateBuilderProposal: GenerateBuilderProposalFromNaturalLanguage;
  readonly getWorkspaceBuilderCapabilityCatalog: GetWorkspaceBuilderCapabilityCatalog;
  readonly prepareBuilderPublication: PrepareBuilderPublication;
  readonly publishBuilderProposal: PublishBuilderProposal;
  readonly getBuilderPublicationReceipt: GetBuilderPublicationReceipt;
}

type BuilderRoute =
  | "generate"
  | "validate"
  | "publicationPrepare"
  | "publicationPublish"
  | { readonly kind: "publicationReceipt"; readonly publicationId: string };

function matchBuilderRoute(path: string): BuilderRoute | undefined {
  if (path === "/v1/builder/proposals/generate") {
    return "generate";
  }
  if (path === "/v1/builder/proposals/validate") {
    return "validate";
  }
  if (path === "/v1/builder/publications/prepare") {
    return "publicationPrepare";
  }
  if (path === "/v1/builder/publications") {
    return "publicationPublish";
  }
  const receiptMatch = /^\/v1\/builder\/publications\/([^/]+)$/.exec(path);
  if (receiptMatch !== null) {
    return {
      kind: "publicationReceipt",
      publicationId: receiptMatch[1]!,
    };
  }
  return undefined;
}

export const V1_HTTP_ROUTES = [
  { method: "POST", path: "/v1/builder/proposals/generate" },
  { method: "POST", path: "/v1/builder/proposals/validate" },
  { method: "POST", path: "/v1/builder/publications/prepare" },
  { method: "POST", path: "/v1/builder/publications" },
  { method: "GET", path: "/v1/builder/publications/:publicationId" },
] as const;

function readProposalFromBody(bodyUnknown: unknown): unknown {
  return typeof bodyUnknown === "object" &&
    bodyUnknown !== null &&
    "proposal" in bodyUnknown
    ? (bodyUnknown as { proposal: unknown }).proposal
    : bodyUnknown;
}

export async function handleBuilderRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  services: BuilderHttpServices,
): Promise<boolean> {
  const route = matchBuilderRoute(path);
  if (route === undefined) {
    return false;
  }

  try {
    const scope = requireControlPlaneScope();

    if (route === "generate") {
      if (method !== "POST") {
        sendJson(response, 405, { status: "method_not_allowed" });
        return true;
      }

      const bodyUnknown = await readJsonBody(request, {
        maxBytes: JSON_BODY_MAX_BYTES,
      });
      const body = bodyUnknown as {
        userInstruction?: unknown;
        generationModelProfileVersionId?: unknown;
        preferences?: unknown;
      };

      if (
        typeof body.userInstruction !== "string" ||
        body.userInstruction.trim().length === 0
      ) {
        sendJson(response, 400, {
          status: "invalid_request",
          error: "userInstruction must be a non-empty string.",
        });
        return true;
      }

      let generationModelProfileVersionId: ModelProfileVersionId | undefined;
      if (body.generationModelProfileVersionId !== undefined) {
        if (typeof body.generationModelProfileVersionId !== "string") {
          sendJson(response, 400, {
            status: "invalid_request",
            error:
              "generationModelProfileVersionId must be a string when provided.",
          });
          return true;
        }
        generationModelProfileVersionId =
          body.generationModelProfileVersionId as ModelProfileVersionId;
      }

      request.setTimeout(BUILDER_GENERATION_REQUEST_TIMEOUT_MS);
      response.setTimeout(BUILDER_GENERATION_REQUEST_TIMEOUT_MS);

      const result: GenerateBuilderProposalResultV1 =
        await services.generateBuilderProposal.execute({
          scope,
          userInstruction: body.userInstruction,
          generationModelProfileVersionId,
          preferences:
            body.preferences === undefined
              ? undefined
              : (body.preferences as never),
        });

      sendJson(response, result.ok ? 200 : 422, result as object);
      return true;
    }

    if (route === "validate") {
      if (method !== "POST") {
        sendJson(response, 405, { status: "method_not_allowed" });
        return true;
      }

      const bodyUnknown = await readJsonBody(request, {
        maxBytes: JSON_BODY_MAX_BYTES,
      });
      const proposalUnknown = readProposalFromBody(bodyUnknown);

      const catalog =
        await services.getWorkspaceBuilderCapabilityCatalog.execute(scope);
      const index = buildBuilderCatalogIndex(catalog);
      const compiled = compileBuilderProposalPrePublication(
        proposalUnknown,
        index,
      );

      sendJson(response, 200, {
        ok: compiled.ok,
        issues: compiled.issues,
        previewLogicalWorkflowDigest: compiled.previewLogicalWorkflowDigest,
        proposal: compiled.proposal,
      });
      return true;
    }

    if (route === "publicationPrepare") {
      if (method !== "POST") {
        sendJson(response, 405, { status: "method_not_allowed" });
        return true;
      }

      const bodyUnknown = await readJsonBody(request, {
        maxBytes: JSON_BODY_MAX_BYTES,
      });
      const proposalUnknown = readProposalFromBody(bodyUnknown);

      const plan = await services.prepareBuilderPublication.execute({
        scope,
        proposalUnknown,
      });

      sendJson(response, 200, plan);
      return true;
    }

    if (route === "publicationPublish") {
      if (method !== "POST") {
        sendJson(response, 405, { status: "method_not_allowed" });
        return true;
      }

      const bodyUnknown = await readJsonBody(request, {
        maxBytes: JSON_BODY_MAX_BYTES,
      });
      const body = bodyUnknown as {
        proposal?: unknown;
        expectedPlanDigest?: unknown;
        idempotencyKey?: unknown;
        acknowledgeUnresolvedRequirements?: unknown;
        confirm?: unknown;
      };

      if (body.confirm !== true) {
        sendJson(response, 400, {
          status: "invalid_request",
          error: "confirm must be true to publish.",
        });
        return true;
      }

      if (typeof body.expectedPlanDigest !== "string") {
        sendJson(response, 400, {
          status: "invalid_request",
          error: "expectedPlanDigest must be a string.",
        });
        return true;
      }

      if (
        typeof body.idempotencyKey !== "string" ||
        body.idempotencyKey.trim().length === 0
      ) {
        sendJson(response, 400, {
          status: "invalid_request",
          error: "idempotencyKey must be a non-empty string.",
        });
        return true;
      }

      const proposalUnknown =
        body.proposal !== undefined
          ? body.proposal
          : readProposalFromBody(bodyUnknown);

      try {
        const result = await services.publishBuilderProposal.execute({
          scope,
          proposalUnknown,
          expectedPlanDigest: body.expectedPlanDigest,
          idempotencyKey: body.idempotencyKey.trim(),
          acknowledgeUnresolvedRequirements:
            body.acknowledgeUnresolvedRequirements === true,
        });

        sendJson(response, result.replay ? 200 : 201, {
          ok: true,
          replay: result.replay,
          receipt: result.receipt,
        });
      } catch (error) {
        if (error instanceof BuilderPublicationNotPublishableError) {
          sendJson(response, 422, {
            ok: false,
            status: "not_publishable",
            error: error.message,
          });
          return true;
        }
        throw error;
      }
      return true;
    }

    if (route.kind === "publicationReceipt") {
      if (method !== "GET") {
        sendJson(response, 405, { status: "method_not_allowed" });
        return true;
      }

      const receipt = await services.getBuilderPublicationReceipt.execute(
        scope,
        route.publicationId as BuilderPublicationId,
      );

      sendJson(response, 200, { ok: true, receipt });
      return true;
    }

    return false;
  } catch (error) {
    if (error instanceof BuilderPublicationNotFoundError) {
      sendJson(response, 404, {
        status: "builder_publication_not_found",
      });
      return true;
    }
    sendHttpError(response, error);
    return true;
  }
}
