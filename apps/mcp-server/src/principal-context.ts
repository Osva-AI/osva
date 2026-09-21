import { AsyncLocalStorage } from "node:async_hooks";

import type { McpPrincipal } from "@osva/contracts";

/**
 * Bridges the Node HTTP request to the MCP SDK per-request server factory.
 * Tool/resource handlers use the principal captured at factory time instead of
 * reading ambient state during execution.
 */
const principalStorage = new AsyncLocalStorage<McpPrincipal>();

export function runWithMcpPrincipal<T>(
  principal: McpPrincipal,
  fn: () => Promise<T>,
): Promise<T> {
  return principalStorage.run(principal, fn);
}

export function getMcpPrincipal(): McpPrincipal {
  const principal = principalStorage.getStore();
  if (principal === undefined) {
    throw new Error("MCP principal is not available in the current context.");
  }
  return principal;
}
