import type { IncomingMessage, ServerResponse } from "node:http";
import type { ModelProfileVersionId } from "@osva-ai/contracts";
import {
  GenerateBuilderProposalFromNaturalLanguage,
  GetWorkspaceBuilderCapabilityCatalog,
  buildBuilderCatalogIndex,
  compileBuilderProposalPrePublication,
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
}

function matchBuilderRoute(path: string): "generate" | "validate" | undefined {
  if (path === "/v1/builder/proposals/generate") {
    return "generate";
  }
  if (path === "/v1/builder/proposals/validate") {
    return "validate";
  }
  return undefined;
}

export const V1_HTTP_ROUTES = [
  { method: "POST", path: "/v1/builder/proposals/generate" },
  { method: "POST", path: "/v1/builder/proposals/validate" },
] as const;

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
      const proposalUnknown =
        typeof bodyUnknown === "object" &&
        bodyUnknown !== null &&
        "proposal" in bodyUnknown
          ? (bodyUnknown as { proposal: unknown }).proposal
          : bodyUnknown;

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

    return false;
  } catch (error) {
    sendHttpError(response, error);
    return true;
  }
}
