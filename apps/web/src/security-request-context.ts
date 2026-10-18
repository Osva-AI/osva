import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import type {
  ApiKeyRequestPrincipal,
  RequestPrincipal,
} from "@osva-ai/contracts";
import { isApiKeyRequestPrincipal } from "@osva-ai/contracts";
import { AuthenticationRequiredError } from "@osva/domain";

export interface SecurityRequestContext {
  readonly requestId: string;
  readonly principal?: RequestPrincipal;
  readonly invalidBearer?: boolean;
}

export function hasInvalidBearerAuthentication(): boolean {
  return getSecurityRequestContext()?.invalidBearer === true;
}

const requestContextStorage = new AsyncLocalStorage<SecurityRequestContext>();

export function runWithSecurityRequestContext<T>(
  context: SecurityRequestContext,
  fn: () => Promise<T>,
): Promise<T> {
  return requestContextStorage.run(context, fn);
}

export function getSecurityRequestContext():
  SecurityRequestContext | undefined {
  return requestContextStorage.getStore();
}

export function getRequestPrincipal(): RequestPrincipal | undefined {
  return requestContextStorage.getStore()?.principal;
}

export function requireRequestPrincipal(): ApiKeyRequestPrincipal {
  const principal = getRequestPrincipal();
  if (principal === undefined || !isApiKeyRequestPrincipal(principal)) {
    throw new AuthenticationRequiredError();
  }

  return principal;
}

export function createRequestId(): string {
  return randomUUID();
}

export function resolveRequestId(): string {
  return getSecurityRequestContext()?.requestId ?? createRequestId();
}
