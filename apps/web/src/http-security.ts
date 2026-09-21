import type { IncomingMessage } from "node:http";

import type { RequestPrincipal } from "@osva/contracts";
import { AuthenticationRequiredError } from "@osva/domain";

import { parseBearerAuthorization } from "./bearer-authorization.js";

export interface WebSecurityServices {
  authenticateBearerToken(token: string): Promise<RequestPrincipal | null>;
}

export async function authenticateRequest(
  request: IncomingMessage,
  security: WebSecurityServices,
): Promise<RequestPrincipal | undefined> {
  const token = parseBearerAuthorization(request.headers.authorization);
  if (token === undefined) {
    return undefined;
  }

  const principal = await security.authenticateBearerToken(token);
  return principal ?? undefined;
}

export async function requireAuthenticatedRequest(
  request: IncomingMessage,
  security: WebSecurityServices,
): Promise<RequestPrincipal> {
  const principal = await authenticateRequest(request, security);
  if (principal === undefined) {
    throw new AuthenticationRequiredError();
  }

  return principal;
}
