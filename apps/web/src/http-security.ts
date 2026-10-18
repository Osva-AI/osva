import type { IncomingMessage } from "node:http";

import type {
  ApiKeyRequestPrincipal,
  RequestPrincipal,
} from "@osva-ai/contracts";
import { AuthenticationRequiredError } from "@osva/domain";

import { parseBearerAuthorization } from "./bearer-authorization.js";

export interface WebSecurityServices {
  authenticateBearerToken(
    token: string,
  ): Promise<ApiKeyRequestPrincipal | null>;
  authenticateHumanSession?(
    request: IncomingMessage,
  ): Promise<RequestPrincipal | null>;
}

export interface AuthenticateRequestResult {
  readonly principal?: RequestPrincipal;
  /** Present when Authorization Bearer was supplied but did not authenticate as an API key. */
  readonly invalidBearer?: boolean;
}

export async function authenticateRequest(
  request: IncomingMessage,
  security: WebSecurityServices,
): Promise<AuthenticateRequestResult> {
  const token = parseBearerAuthorization(request.headers.authorization);
  if (token !== undefined) {
    const apiKeyPrincipal = await security.authenticateBearerToken(token);
    if (apiKeyPrincipal === null) {
      return { invalidBearer: true };
    }
    return { principal: apiKeyPrincipal };
  }

  if (security.authenticateHumanSession !== undefined) {
    const sessionPrincipal = await security.authenticateHumanSession(request);
    if (sessionPrincipal !== null) {
      return { principal: sessionPrincipal };
    }
  }

  return {};
}

export async function requireAuthenticatedRequest(
  request: IncomingMessage,
  security: WebSecurityServices,
): Promise<RequestPrincipal> {
  const result = await authenticateRequest(request, security);
  if (result.invalidBearer === true || result.principal === undefined) {
    throw new AuthenticationRequiredError();
  }

  return result.principal;
}
