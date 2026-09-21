import type { IncomingMessage } from "node:http";
import type { McpPrincipal, WorkspaceId } from "@osva/contracts";
import { timingSafeEqual } from "node:crypto";

export interface McpAuthenticator {
  authenticate(request: IncomingMessage): McpPrincipal | undefined;
}

export interface BearerTokenMcpAuthenticatorOptions {
  readonly tokens: ReadonlyMap<string, WorkspaceId>;
}

export function createBearerTokenMcpAuthenticator(
  options: BearerTokenMcpAuthenticatorOptions,
): McpAuthenticator {
  const tokenEntries = [...options.tokens.entries()];

  return {
    authenticate(request) {
      const authorization = headerValue(request.headers.authorization);
      if (authorization === undefined) {
        return undefined;
      }

      const match = /^Bearer\s+(.+)$/i.exec(authorization);
      if (match === null) {
        return undefined;
      }

      const presented = match[1]!.trim();
      if (presented.length === 0) {
        return undefined;
      }

      for (const [configured, workspaceId] of tokenEntries) {
        if (tokensEqual(presented, configured)) {
          return { workspaceId };
        }
      }

      return undefined;
    },
  };
}

function tokensEqual(presented: string, configured: string): boolean {
  const presentedBuffer = Buffer.from(presented);
  const configuredBuffer = Buffer.from(configured);
  if (presentedBuffer.length !== configuredBuffer.length) {
    return false;
  }

  return timingSafeEqual(presentedBuffer, configuredBuffer);
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
