import type { ToolAuthorizationContext, ToolPolicy } from "@osva/contracts";

/**
 * Community Alpha default policy: bound ToolVersions that reach the gateway
 * are allowed. Unbound tools are rejected by the runtime before invocation.
 */
export class DefaultToolPolicy implements ToolPolicy {
  authorizeToolInvocation(context: ToolAuthorizationContext): void {
    void context;
  }
}
