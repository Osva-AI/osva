import type { ToolAuthorizationContext, ToolPolicy } from "@osva-ai/contracts";

/**
 * Production default ToolPolicy hook. Binding membership is enforced by trusted
 * runtimes (ExecutionRequest.toolVersionBindings) before ToolGateway.invoke.
 * ToolGateway independently verifies ToolVersion / ConnectorVersion workspace
 * ownership and request vs authorization ToolVersion identity.
 */
export class DefaultToolPolicy implements ToolPolicy {
  authorizeToolInvocation(context: ToolAuthorizationContext): void {
    void context;
  }
}
