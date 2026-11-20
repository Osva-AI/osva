import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  InferenceBudgetPeriodKeyV1,
  InferenceBudgetPolicyId,
  InferenceBudgetPolicyVersionId,
} from "@osva-ai/contracts";
import {
  activateWorkspaceInferenceBudgetRequestSchema,
  appendInferenceBudgetPolicyVersionRequestSchema,
  createInferenceBudgetPolicyRequestSchema,
  inferenceBudgetPeriodUsageQuerySchema,
  inferenceBudgetPolicyIdSchema,
  inferenceBudgetPolicyVersionIdSchema,
  parseInferenceBudgetPolicyDefinition,
} from "@osva-ai/contracts/schemas";
import {
  CONTROL_PLANE_RESOURCE_KINDS,
  type InferenceBudgetApplication,
} from "@osva/domain";

import {
  authorizeControlPlaneAdmin,
  authorizeControlPlaneRead,
  requireControlPlaneScope,
} from "./control-plane-http.js";
import { sendHttpError } from "./http-errors.js";
import { readJsonBody, sendJson } from "./json.js";
import { resolveRequestId } from "./security-request-context.js";

export interface InferenceBudgetHttpServices {
  readonly inferenceBudget: InferenceBudgetApplication;
  readonly ids: {
    createPolicyId(): InferenceBudgetPolicyId;
    createPolicyVersionId(): InferenceBudgetPolicyVersionId;
  };
}

export const V1_HTTP_ROUTES = [
  { method: "POST", path: "/v1/inference-budget-policies" },
  { method: "GET", path: "/v1/inference-budget-policies" },
  { method: "GET", path: "/v1/inference-budget-policies/:id" },
  { method: "GET", path: "/v1/inference-budget-policies/:id/versions" },
  { method: "POST", path: "/v1/inference-budget-policies/:id/versions" },
  { method: "GET", path: "/v1/inference-budget-policy-versions/:id" },
  { method: "GET", path: "/v1/workspace-inference-budget/configuration" },
  { method: "GET", path: "/v1/workspace-inference-budget/activation" },
  { method: "POST", path: "/v1/workspace-inference-budget/activate" },
  { method: "POST", path: "/v1/workspace-inference-budget/disable" },
  { method: "GET", path: "/v1/workspace-inference-budget/period-usage" },
] as const;

type InferenceBudgetMatchedRoute =
  | {
      readonly kind: "policy";
      readonly policyId: InferenceBudgetPolicyId;
    }
  | {
      readonly kind: "policyVersions";
      readonly policyId: InferenceBudgetPolicyId;
    }
  | {
      readonly kind: "policyVersion";
      readonly policyVersionId: InferenceBudgetPolicyVersionId;
    };

function matchInferenceBudgetRoute(
  path: string,
): InferenceBudgetMatchedRoute | undefined {
  const policyVersion = path.match(
    /^\/v1\/inference-budget-policy-versions\/([^/]+)$/,
  );
  if (policyVersion !== null) {
    const parsed = inferenceBudgetPolicyVersionIdSchema.safeParse(
      policyVersion[1],
    );
    if (!parsed.success) {
      return undefined;
    }
    return { kind: "policyVersion", policyVersionId: parsed.data };
  }

  const policyVersions = path.match(
    /^\/v1\/inference-budget-policies\/([^/]+)\/versions$/,
  );
  if (policyVersions !== null) {
    const parsed = inferenceBudgetPolicyIdSchema.safeParse(policyVersions[1]);
    if (!parsed.success) {
      return undefined;
    }
    return { kind: "policyVersions", policyId: parsed.data };
  }

  const policy = path.match(/^\/v1\/inference-budget-policies\/([^/]+)$/);
  if (policy !== null) {
    const parsed = inferenceBudgetPolicyIdSchema.safeParse(policy[1]);
    if (!parsed.success) {
      return undefined;
    }
    return { kind: "policy", policyId: parsed.data };
  }

  return undefined;
}

export async function handleInferenceBudgetRequest(
  request: IncomingMessage,
  response: ServerResponse,
  method: string,
  path: string,
  searchParams: URLSearchParams,
  services: InferenceBudgetHttpServices,
): Promise<boolean> {
  const resource = CONTROL_PLANE_RESOURCE_KINDS.inferenceBudgetPolicy;
  const matched = matchInferenceBudgetRoute(path);

  if (method === "POST" && path === "/v1/inference-budget-policies") {
    try {
      const scope = requireControlPlaneScope();
      authorizeControlPlaneAdmin(scope, resource);
      const body = await readJsonBody(request);
      const parsed = createInferenceBudgetPolicyRequestSchema.safeParse(body);
      if (!parsed.success) {
        sendHttpError(response, parsed.error);
        return true;
      }
      const definition = parseInferenceBudgetPolicyDefinition(
        parsed.data.definition,
      );
      const created =
        await services.inferenceBudget.createInferenceBudgetPolicy.execute(
          scope,
          {
            key: parsed.data.key,
            definition,
          },
        );
      sendJson(response, 201, created);
      return true;
    } catch (error) {
      sendHttpError(response, error);
      return true;
    }
  }

  if (method === "GET" && path === "/v1/inference-budget-policies") {
    try {
      const scope = requireControlPlaneScope();
      authorizeControlPlaneRead(scope, resource);
      const policies =
        await services.inferenceBudget.listInferenceBudgetPolicies.execute(
          scope,
        );
      sendJson(response, 200, { policies });
      return true;
    } catch (error) {
      sendHttpError(response, error);
      return true;
    }
  }

  if (method === "GET" && matched?.kind === "policy") {
    try {
      const scope = requireControlPlaneScope();
      authorizeControlPlaneRead(scope, resource);
      const policy =
        await services.inferenceBudget.getInferenceBudgetPolicy.execute(
          scope,
          matched.policyId,
        );
      sendJson(response, 200, policy);
      return true;
    } catch (error) {
      sendHttpError(response, error);
      return true;
    }
  }

  if (method === "GET" && matched?.kind === "policyVersions") {
    try {
      const scope = requireControlPlaneScope();
      authorizeControlPlaneRead(scope, resource);
      const versions =
        await services.inferenceBudget.listInferenceBudgetPolicyVersions.execute(
          scope,
          matched.policyId,
        );
      sendJson(response, 200, { versions });
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
        await services.inferenceBudget.getInferenceBudgetPolicyVersion.execute(
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

  if (method === "POST" && matched?.kind === "policyVersions") {
    try {
      const scope = requireControlPlaneScope();
      authorizeControlPlaneAdmin(scope, resource);
      const body = await readJsonBody(request);
      const parsed =
        appendInferenceBudgetPolicyVersionRequestSchema.safeParse(body);
      if (!parsed.success) {
        sendHttpError(response, parsed.error);
        return true;
      }
      const definition = parseInferenceBudgetPolicyDefinition(
        parsed.data.definition,
      );
      const version =
        await services.inferenceBudget.appendInferenceBudgetPolicyVersion.execute(
          scope,
          {
            policyId: matched.policyId,
            definition,
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

  if (
    method === "GET" &&
    path === "/v1/workspace-inference-budget/activation"
  ) {
    try {
      const scope = requireControlPlaneScope();
      authorizeControlPlaneRead(scope, resource);
      const status =
        await services.inferenceBudget.getWorkspaceInferenceBudgetActivationStatus.execute(
          scope,
        );
      sendJson(response, 200, status);
      return true;
    } catch (error) {
      sendHttpError(response, error);
      return true;
    }
  }

  if (method === "POST" && path === "/v1/workspace-inference-budget/activate") {
    try {
      const scope = requireControlPlaneScope();
      authorizeControlPlaneAdmin(scope, resource);
      const body = await readJsonBody(request);
      const parsed =
        activateWorkspaceInferenceBudgetRequestSchema.safeParse(body);
      if (!parsed.success) {
        sendHttpError(response, parsed.error);
        return true;
      }
      const configuration =
        await services.inferenceBudget.activateWorkspaceInferenceBudget.execute(
          scope,
          {
            policyVersionId: parsed.data.policyVersionId,
            correlationId: resolveRequestId(),
          },
        );
      sendJson(response, 200, configuration);
      return true;
    } catch (error) {
      sendHttpError(response, error);
      return true;
    }
  }

  if (method === "POST" && path === "/v1/workspace-inference-budget/disable") {
    try {
      const scope = requireControlPlaneScope();
      authorizeControlPlaneAdmin(scope, resource);
      await readJsonBody(request);
      const configuration =
        await services.inferenceBudget.disableWorkspaceInferenceBudget.execute(
          scope,
          { correlationId: resolveRequestId() },
        );
      sendJson(response, 200, configuration);
      return true;
    } catch (error) {
      sendHttpError(response, error);
      return true;
    }
  }

  if (
    method === "GET" &&
    path === "/v1/workspace-inference-budget/configuration"
  ) {
    try {
      const scope = requireControlPlaneScope();
      authorizeControlPlaneRead(scope, resource);
      const configuration =
        await services.inferenceBudget.getWorkspaceInferenceBudgetConfiguration.execute(
          scope,
        );
      sendJson(response, 200, configuration);
      return true;
    } catch (error) {
      sendHttpError(response, error);
      return true;
    }
  }

  if (
    method === "GET" &&
    path === "/v1/workspace-inference-budget/period-usage"
  ) {
    try {
      const scope = requireControlPlaneScope();
      authorizeControlPlaneRead(scope, resource);
      const query = inferenceBudgetPeriodUsageQuerySchema.safeParse({
        periodKey: searchParams.get("periodKey") ?? undefined,
      });
      if (!query.success) {
        sendHttpError(response, query.error);
        return true;
      }
      const usage =
        await services.inferenceBudget.getInferenceBudgetPeriodUsage.execute(
          scope,
          query.data.periodKey as InferenceBudgetPeriodKeyV1 | undefined,
        );
      sendJson(response, 200, usage);
      return true;
    } catch (error) {
      sendHttpError(response, error);
      return true;
    }
  }

  return false;
}
