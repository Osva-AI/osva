import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import type { RequestPrincipal } from "@osva/contracts";
import { AuthenticationRequiredError } from "@osva/domain";

export interface SecurityRequestContext {
  readonly requestId: string;
  readonly principal?: RequestPrincipal;
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

export function requireRequestPrincipal(): RequestPrincipal {
  const principal = getRequestPrincipal();
  if (principal === undefined) {
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
