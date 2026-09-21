import type { IncomingMessage } from "node:http";
import type {
  ApiKeyId,
  AuthContextResourceV1,
  CommunityEditionRole,
  McpPrincipal,
  WorkspaceId,
} from "@osva/contracts";

/** Request-scoped MCP authentication result (not a public contract). */
export interface AuthenticatedMcpIdentity {
  readonly principal: McpPrincipal;
  readonly bearerCredential: string;
}

export interface McpAuthenticator {
  authenticate(
    request: IncomingMessage,
  ): Promise<AuthenticatedMcpIdentity | undefined>;
}

export interface RestAuthContextMcpAuthenticatorOptions {
  readonly osvaApiBaseUrl: string;
  readonly fetch?: typeof fetch;
}

export class McpAuthenticationServiceUnavailableError extends Error {
  constructor() {
    super("OSVA control-plane authentication is unavailable.");
    this.name = "McpAuthenticationServiceUnavailableError";
  }
}

export function createRestAuthContextMcpAuthenticator(
  options: RestAuthContextMcpAuthenticatorOptions,
): McpAuthenticator {
  const baseUrl = options.osvaApiBaseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? fetch;

  return {
    async authenticate(request) {
      const token = extractBearerToken(request);
      if (token === undefined) {
        return undefined;
      }

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/v1/auth/context`, {
          method: "GET",
          headers: {
            authorization: `Bearer ${token}`,
          },
          redirect: "manual",
        });
      } catch {
        throw new McpAuthenticationServiceUnavailableError();
      }

      if (response.status === 401 || response.status === 403) {
        return undefined;
      }

      if (!response.ok) {
        throw new McpAuthenticationServiceUnavailableError();
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new McpAuthenticationServiceUnavailableError();
      }

      if (
        typeof body !== "object" ||
        body === null ||
        typeof (body as AuthContextResourceV1).subjectId !== "string" ||
        typeof (body as AuthContextResourceV1).workspaceId !== "string" ||
        typeof (body as AuthContextResourceV1).role !== "string"
      ) {
        throw new McpAuthenticationServiceUnavailableError();
      }

      const context = body as AuthContextResourceV1;
      return {
        principal: {
          subjectId: context.subjectId as ApiKeyId,
          workspaceId: context.workspaceId as WorkspaceId,
          role: context.role as CommunityEditionRole,
        },
        bearerCredential: token,
      };
    },
  };
}

function extractBearerToken(request: IncomingMessage): string | undefined {
  const authorization = headerValue(request.headers.authorization);
  if (authorization === undefined) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (match === null) {
    return undefined;
  }

  const presented = match[1]!.trim();
  return presented.length === 0 ? undefined : presented;
}

function headerValue(
  value: string | readonly string[] | undefined,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value;
  }

  return value[0];
}
