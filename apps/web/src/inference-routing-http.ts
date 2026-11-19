import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  InferenceRoutingDecisionId,
  InferenceRoutingPolicyId,
  InferenceRoutingPolicyVersionId,
} from "@osva-ai/contracts";
import {
  activateInferenceRoutingPolicyRequestSchema,
  appendInferenceRoutingPolicyVersionRequestSchema,
  createInferenceRoutingPolicyRequestSchema,
  inferenceRoutingDecisionIdSchema,
  inferenceRoutingPolicyIdSchema,
  inferenceRoutingPolicyVersionIdSchema,
} from "@osva-ai/contracts/schemas";
import {
  CONTROL_PLANE_RESOURCE_KINDS,
  type InferenceRoutingApplication,
} from "@osva/domain";

import {
  authorizeControlPlaneAdmin,
  authorizeControlPlaneRead,
  requireControlPlaneScope,
} from "./control-plane-http.js";
import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";

export interface InferenceRoutingHttpServices {
  readonly inferenceRouting: InferenceRoutingApplication;
  readonly ids: {
    createPolicyId(): InferenceRoutingPolicyId;
    createPolicyVersionId(): InferenceRoutingPolicyVersionId;
  };
}

export const V1_HTTP_ROUTES = [
  { method: "POST", path: "/v1/inference-routing-policies" },
  { method: "GET", path: "/v1/inference-routing-policies" },
  { method: "POST", path: "/v1/inference-routing-policies/:id/versions" },
  { method: "POST", path: "/v1/inference-routing-policies/activate" },
  { method: "GET", path: "/v1/inference-routing-policy-versions/:id" },
  { method: "GET", path: "/v1/inference-routing-decisions/:id" },
] as const;

type InferenceRoutingMatchedRoute =
  | {
      readonly kind: "policyVersion";
      readonly policyVersionId: InferenceRoutingPolicyVersionId;
    }
  | {
      readonly kind: "decision";
      readonly decisionId: InferenceRoutingDecisionId;
    }
  | {
      readonly kind: "appendVersion";
      readonly policyId: InferenceRoutingPolicyId;
    };

function matchInferenceRoutingRoute(
  path: string,
): InferenceRoutingMatchedRoute | undefined {
  const policyVersion = path.match(
    /^\/v1\/inference-routing-policy-versions\/([^/]+)$/,
  );
  if (policyVersion !== null) {
    const parsed = inferenceRoutingPolicyVersionIdSchema.safeParse(
      policyVersion[1],
    );
    if (!parsed.success) {
      return undefined;
    }
    return { kind: "policyVersion", policyVersionId: parsed.data };
  }
  const decision = path.match(/^\/v1\/inference-routing-decisions\/([^/]+)$/);
  if (decision !== null) {
    const parsed = inferenceRoutingDecisionIdSchema.safeParse(decision[1]);
    if (!parsed.success) {
      return undefined;
    }
    return { kind: "decision", decisionId: parsed.data };
  }
  const appendVersion = path.match(
    /^\/v1\/inference-routing-policies\/([^/]+)\/versions$/,
  );
  if (appendVersion !== null) {
    const parsed = inferenceRoutingPolicyIdSchema.safeParse(appendVersion[1]);
    if (!parsed.success) {
      return undefined;
    }
    return { kind: "appendVersion", policyId: parsed.data };
  }
  return undefined;
}

export async function handleInferenceRoutingRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  services: InferenceRoutingHttpServices,
): Promise<boolean> {
  const resource = CONTROL_PLANE_RESOURCE_KINDS.inferenceRoutingPolicy;
  const matched = matchInferenceRoutingRoute(path);

  if (method === "POST" && path === "/v1/inference-routing-policies") {
    try {
      const scope = requireControlPlaneScope();
      authorizeControlPlaneAdmin(scope, resource);
      const body = await readJsonBody(request);
      const parsed = createInferenceRoutingPolicyRequestSchema.safeParse(body);
      if (!parsed.success) {
        sendHttpError(response, parsed.error);
        return true;
      }
      const created =
        await services.inferenceRouting.createInferenceRoutingPolicy.execute(
          scope,
          parsed.data,
        );
      sendJson(response, 201, created);
      return true;
    } catch (error) {
      sendHttpError(response, error);
      return true;
    }
  }

  if (method === "GET" && path === "/v1/inference-routing-policies") {
    try {
      const scope = requireControlPlaneScope();
      authorizeControlPlaneRead(scope, resource);
      const policies =
        await services.inferenceRouting.listInferenceRoutingPolicies.execute(
          scope,
        );
      sendJson(response, 200, { policies });
      return true;
    } catch (error) {
      sendHttpError(response, error);
      return true;
    }
  }

  if (method === "GET" && matched?.kind === "policyVersion") {
    try {
      const scope = requireControlPlaneScope();
      authorizeControlPlaneRead(scope, resource);
      const version =
        await services.inferenceRouting.getInferenceRoutingPolicyVersion.execute(
          scope,
          matched.policyVersionId,
        );
      sendJson(response, 200, version);
      return true;
    } catch (error) {
      sendHttpError(response, error);
      return true;
    }
  }

  if (method === "GET" && matched?.kind === "decision") {
    try {
      const scope = requireControlPlaneScope();
      authorizeControlPlaneRead(scope, resource);
      const decision =
        await services.inferenceRouting.getInferenceRoutingDecision.execute(
          scope,
          matched.decisionId,
        );
      sendJson(response, 200, decision);
      return true;
    } catch (error) {
      sendHttpError(response, error);
      return true;
    }
  }

  if (method === "POST" && path === "/v1/inference-routing-policies/activate") {
    try {
      const scope = requireControlPlaneScope();
      authorizeControlPlaneAdmin(scope, resource);
      const body = await readJsonBody(request);
      const parsed =
        activateInferenceRoutingPolicyRequestSchema.safeParse(body);
      if (!parsed.success) {
        sendHttpError(response, parsed.error);
        return true;
      }
      const runtime =
        await services.inferenceRouting.activateInferenceRoutingPolicy.execute(
          scope,
          {
            policyVersionId: parsed.data.policyVersionId,
            enabled: parsed.data.enabled,
          },
        );
      if (runtime === null) {
        sendJson(response, 500, { status: "internal_error" });
        return true;
      }
      sendJson(response, 200, runtime);
      return true;
    } catch (error) {
      sendHttpError(response, error);
      return true;
    }
  }

  if (method === "POST" && matched?.kind === "appendVersion") {
    try {
      const scope = requireControlPlaneScope();
      authorizeControlPlaneAdmin(scope, resource);
      const body = await readJsonBody(request);
      const parsed =
        appendInferenceRoutingPolicyVersionRequestSchema.safeParse(body);
      if (!parsed.success) {
        sendHttpError(response, parsed.error);
        return true;
      }
      const version =
        await services.inferenceRouting.appendInferenceRoutingPolicyVersion.execute(
          scope,
          {
            policyId: matched.policyId,
            definition: parsed.data.definition,
          },
        );
      if (version === null) {
        sendJson(response, 500, { status: "internal_error" });
        return true;
      }
      sendJson(response, 201, version);
      return true;
    } catch (error) {
      sendHttpError(response, error);
      return true;
    }
  }

  return false;
}
