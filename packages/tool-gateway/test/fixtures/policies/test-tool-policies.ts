import type {
  ToolAuthorizationContext,
  ToolPolicy,
  ToolVersionId,
} from "@osva-ai/contracts";
import { TOOL_ERROR_CODES } from "@osva-ai/contracts";

import { ToolGatewayError } from "../../../src/index.js";

/** Mirrors runtime binding resolution before ToolGateway.invoke. */
export class RuntimeBindingToolPolicy implements ToolPolicy {
  constructor(
    private readonly bindings: Readonly<
      Record<string, ToolVersionId | undefined>
    >,
  ) {}

  authorizeToolInvocation(context: ToolAuthorizationContext): void {
    const bound = this.bindings[context.bindingName];
    if (bound === undefined) {
      throw new ToolGatewayError(
        TOOL_ERROR_CODES.TOOL_BINDING_NOT_FOUND,
        "Tool binding was not found.",
      );
    }

    if (bound !== context.toolVersionId) {
      throw new ToolGatewayError(
        TOOL_ERROR_CODES.TOOL_NOT_AUTHORIZED,
        "Tool binding does not match the requested ToolVersion.",
      );
    }
  }
}

export class DenyingToolPolicy implements ToolPolicy {
  authorizeToolInvocation(context: ToolAuthorizationContext): void {
    void context;
    throw new ToolGatewayError(
      TOOL_ERROR_CODES.TOOL_NOT_AUTHORIZED,
      "Tool invocation was denied by policy.",
    );
  }
}

export class WorkspaceScopedToolPolicy implements ToolPolicy {
  constructor(
    private readonly allowedWorkspaceId: ToolAuthorizationContext["workspaceId"],
    private readonly inner: ToolPolicy = new DenyingToolPolicy(),
  ) {}

  authorizeToolInvocation(context: ToolAuthorizationContext): void {
    if (context.workspaceId !== this.allowedWorkspaceId) {
      throw new ToolGatewayError(
        TOOL_ERROR_CODES.TOOL_NOT_AUTHORIZED,
        "Tool invocation was denied for this workspace.",
      );
    }

    this.inner.authorizeToolInvocation(context);
  }
}
