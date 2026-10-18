import type { IncomingMessage, ServerResponse } from "node:http";

import type { WorkspaceId, WorkspaceMembershipId } from "@osva-ai/contracts";

import type { ConsoleConfig } from "../config.js";
import { sendJson } from "../console-http.js";
import {
  createHumanSessionUpstream,
  type HumanSessionUpstreamContext,
} from "../human-session-upstream.js";
import { readJsonBody } from "../read-json-body.js";
import type { ResponseSecurityOptions } from "../response-security.js";
import { appendSanitizedSetCookies } from "../session-cookie.js";
import { upstreamRequestIdHeaders } from "../upstream-response.js";
import { readBrowserWorkspaceIdOrReject } from "../workspace-header.js";

export async function tryHandleConsoleAuthApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  method: string,
  deps: {
    readonly config: ConsoleConfig;
    readonly security: ResponseSecurityOptions;
    readonly ctx: HumanSessionUpstreamContext;
  },
): Promise<boolean> {
  if (
    !pathname.startsWith("/api/v1/auth/") &&
    pathname !== "/api/v1/me/workspaces"
  ) {
    return false;
  }

  const upstream = createHumanSessionUpstream(deps.config);

  if (pathname === "/api/v1/auth/login" && method === "POST") {
    const body = await readJsonBody(request);
    const result = await upstream.requestJson(deps.ctx, {
      method: "POST",
      path: "/v1/auth/login",
      body,
      requireWorkspace: false,
    });
    appendSanitizedSetCookies(response, result.setCookie);
    sendJson(
      response,
      result.status,
      result.data,
      upstreamRequestIdHeaders(result.requestId),
      deps.security,
    );
    return true;
  }

  if (pathname === "/api/v1/auth/logout" && method === "POST") {
    const result = await upstream.requestJson(deps.ctx, {
      method: "POST",
      path: "/v1/auth/logout",
      requireWorkspace: false,
    });
    appendSanitizedSetCookies(response, result.setCookie);
    response.writeHead(204, {
      ...upstreamRequestIdHeaders(result.requestId),
      "Cache-Control": "no-store",
    });
    response.end();
    return true;
  }

  if (pathname === "/api/v1/auth/session" && method === "GET") {
    const result = await upstream.requestJson(deps.ctx, {
      method: "GET",
      path: "/v1/auth/session",
      requireWorkspace: false,
    });
    appendSanitizedSetCookies(response, result.setCookie);
    sendJson(
      response,
      result.status,
      result.data,
      upstreamRequestIdHeaders(result.requestId),
      deps.security,
    );
    return true;
  }

  if (pathname === "/api/v1/auth/me" && method === "GET") {
    const result = await upstream.requestJson(deps.ctx, {
      method: "GET",
      path: "/v1/auth/me",
      requireWorkspace: false,
    });
    appendSanitizedSetCookies(response, result.setCookie);
    sendJson(
      response,
      result.status,
      result.data,
      upstreamRequestIdHeaders(result.requestId),
      deps.security,
    );
    return true;
  }

  if (
    (pathname === "/api/v1/auth/workspaces" ||
      pathname === "/api/v1/me/workspaces") &&
    method === "GET"
  ) {
    const result = await upstream.requestJson(deps.ctx, {
      method: "GET",
      path: "/v1/me/workspaces",
      requireWorkspace: false,
    });
    sendJson(
      response,
      result.status,
      result.data,
      upstreamRequestIdHeaders(result.requestId),
      deps.security,
    );
    return true;
  }

  if (pathname === "/api/v1/auth/setup/complete" && method === "POST") {
    const body = await readJsonBody(request);
    const result = await upstream.requestJson(deps.ctx, {
      method: "POST",
      path: "/v1/auth/setup/complete",
      body,
      requireWorkspace: false,
    });
    sendJson(
      response,
      result.status,
      result.data,
      upstreamRequestIdHeaders(result.requestId),
      deps.security,
    );
    return true;
  }

  if (pathname === "/api/v1/auth/recovery/complete" && method === "POST") {
    const body = await readJsonBody(request);
    const result = await upstream.requestJson(deps.ctx, {
      method: "POST",
      path: "/v1/auth/recovery/complete",
      body,
      requireWorkspace: false,
    });
    sendJson(
      response,
      result.status,
      result.data,
      upstreamRequestIdHeaders(result.requestId),
      deps.security,
    );
    return true;
  }

  if (pathname === "/api/v1/auth/audit-events" && method === "GET") {
    const workspace = requireWorkspaceHeader(request, response, deps.security);
    if (workspace === undefined) {
      return true;
    }
    const result = await upstream.requestJson(
      { ...deps.ctx, workspaceId: workspace },
      {
        method: "GET",
        path: "/v1/auth/audit-events",
      },
    );
    sendJson(
      response,
      result.status,
      result.data,
      upstreamRequestIdHeaders(result.requestId),
      deps.security,
    );
    return true;
  }

  const membershipsMatch = pathname.match(
    /^\/api\/v1\/auth\/workspaces\/([^/]+)\/memberships$/,
  );
  if (membershipsMatch !== null) {
    const workspaceId = membershipsMatch[1] as WorkspaceId;
    if (method === "GET") {
      const result = await upstream.requestJson(
        { ...deps.ctx, workspaceId },
        {
          method: "GET",
          path: `/v1/auth/workspaces/${encodeURIComponent(workspaceId)}/memberships`,
        },
      );
      sendJson(
        response,
        result.status,
        result.data,
        upstreamRequestIdHeaders(result.requestId),
        deps.security,
      );
      return true;
    }
    if (method === "POST") {
      const body = await readJsonBody(request);
      const result = await upstream.requestJson(
        { ...deps.ctx, workspaceId },
        {
          method: "POST",
          path: `/v1/auth/workspaces/${encodeURIComponent(workspaceId)}/memberships`,
          body,
        },
      );
      sendJson(
        response,
        result.status,
        result.data,
        upstreamRequestIdHeaders(result.requestId),
        deps.security,
      );
      return true;
    }
  }

  const membersUsersMatch = pathname.match(
    /^\/api\/v1\/auth\/workspaces\/([^/]+)\/members\/users$/,
  );
  if (membersUsersMatch !== null && method === "POST") {
    const workspaceId = membersUsersMatch[1] as WorkspaceId;
    const body = await readJsonBody(request);
    const result = await upstream.requestJson(
      { ...deps.ctx, workspaceId },
      {
        method: "POST",
        path: `/v1/auth/workspaces/${encodeURIComponent(workspaceId)}/members/users`,
        body,
      },
    );
    sendJson(
      response,
      result.status,
      result.data,
      upstreamRequestIdHeaders(result.requestId),
      deps.security,
    );
    return true;
  }

  const grantOwnerMatch = pathname.match(
    /^\/api\/v1\/auth\/workspaces\/([^/]+)\/memberships\/([^/]+)\/grant-owner$/,
  );
  if (grantOwnerMatch !== null && method === "POST") {
    const workspaceId = grantOwnerMatch[1] as WorkspaceId;
    const membershipId = grantOwnerMatch[2] as WorkspaceMembershipId;
    const result = await upstream.requestJson(
      { ...deps.ctx, workspaceId },
      {
        method: "POST",
        path: `/v1/auth/workspaces/${encodeURIComponent(workspaceId)}/memberships/${encodeURIComponent(membershipId)}/grant-owner`,
      },
    );
    sendJson(
      response,
      result.status,
      result.data,
      upstreamRequestIdHeaders(result.requestId),
      deps.security,
    );
    return true;
  }

  const transferMatch = pathname.match(
    /^\/api\/v1\/auth\/workspaces\/([^/]+)\/ownership\/transfer$/,
  );
  if (transferMatch !== null && method === "POST") {
    const workspaceId = transferMatch[1] as WorkspaceId;
    const body = await readJsonBody(request);
    const result = await upstream.requestJson(
      { ...deps.ctx, workspaceId },
      {
        method: "POST",
        path: `/v1/auth/workspaces/${encodeURIComponent(workspaceId)}/ownership/transfer`,
        body,
      },
    );
    sendJson(
      response,
      result.status,
      result.data,
      upstreamRequestIdHeaders(result.requestId),
      deps.security,
    );
    return true;
  }

  const membershipItemMatch = pathname.match(
    /^\/api\/v1\/auth\/workspaces\/([^/]+)\/memberships\/([^/]+)$/,
  );
  if (membershipItemMatch !== null) {
    const workspaceId = membershipItemMatch[1] as WorkspaceId;
    const membershipId = membershipItemMatch[2] as WorkspaceMembershipId;
    if (method === "PATCH") {
      const body = await readJsonBody(request);
      const result = await upstream.requestJson(
        { ...deps.ctx, workspaceId },
        {
          method: "PATCH",
          path: `/v1/auth/workspaces/${encodeURIComponent(workspaceId)}/memberships/${encodeURIComponent(membershipId)}`,
          body,
        },
      );
      sendJson(
        response,
        result.status,
        result.data,
        upstreamRequestIdHeaders(result.requestId),
        deps.security,
      );
      return true;
    }
    if (method === "DELETE") {
      const result = await upstream.requestJson(
        { ...deps.ctx, workspaceId },
        {
          method: "DELETE",
          path: `/v1/auth/workspaces/${encodeURIComponent(workspaceId)}/memberships/${encodeURIComponent(membershipId)}`,
        },
      );
      sendJson(
        response,
        result.status,
        result.data,
        upstreamRequestIdHeaders(result.requestId),
        deps.security,
      );
      return true;
    }
  }

  return false;
}

function requireWorkspaceHeader(
  request: IncomingMessage,
  response: ServerResponse,
  security: ResponseSecurityOptions,
): string | undefined {
  const header = readBrowserWorkspaceIdOrReject(request);
  if ("invalid" in header) {
    sendJson(
      response,
      400,
      {
        error: "A valid x-osva-workspace-id header is required.",
        code: "workspace_selection_required",
      },
      {},
      security,
    );
    return undefined;
  }
  return header.workspaceId;
}
