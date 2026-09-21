import { AsyncLocalStorage } from "node:async_hooks";

import type { McpPrincipal } from "@osva/contracts";

import type { AuthenticatedMcpIdentity } from "./auth.js";

/**
 * Bridges the Node HTTP request to the MCP SDK per-request server factory.
 * Tool/resource handlers use the principal captured at factory time instead of
 * reading ambient state during execution.
 */
const identityStorage = new AsyncLocalStorage<AuthenticatedMcpIdentity>();

export function runWithMcpAuthenticatedIdentity<T>(
  identity: AuthenticatedMcpIdentity,
  fn: () => Promise<T>,
): Promise<T> {
  return identityStorage.run(identity, fn);
}

/** @deprecated Use runWithMcpAuthenticatedIdentity. */
export const runWithMcpPrincipal = runWithMcpAuthenticatedIdentity;

export function getMcpPrincipal(): McpPrincipal {
  const identity = identityStorage.getStore();
  if (identity === undefined) {
    throw new Error("MCP principal is not available in the current context.");
  }
  return identity.principal;
}

/** Request-scoped bearer credential for outbound REST only; never log or serialize. */
export function getMcpBearerCredential(): string {
  const identity = identityStorage.getStore();
  if (identity === undefined) {
    throw new Error(
      "MCP bearer credential is not available in the current context.",
    );
  }
  return identity.bearerCredential;
}
