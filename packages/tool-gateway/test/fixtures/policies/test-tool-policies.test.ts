import type {
  ToolAuthorizationContext,
  ToolVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import { TOOL_ERROR_CODES } from "@osva-ai/contracts";
import { describe, expect, it } from "vitest";

import { ToolGatewayError } from "../../../src/index.js";
import {
  DenyingToolPolicy,
  RuntimeBindingToolPolicy,
  WorkspaceScopedToolPolicy,
} from "./test-tool-policies.js";

const context = {
  workspaceId: "ws-a" as WorkspaceId,
  agentId: "agent-1",
  runId: "run-1",
  runAttemptId: "attempt-1",
  bindingName: "echo",
  toolVersionId: "tv-1" as ToolVersionId,
} as ToolAuthorizationContext;

describe("RuntimeBindingToolPolicy", () => {
  it("rejects unknown binding names", () => {
    const policy = new RuntimeBindingToolPolicy({});
    expect(() => policy.authorizeToolInvocation(context)).toThrow(
      expect.objectContaining({
        code: TOOL_ERROR_CODES.TOOL_BINDING_NOT_FOUND,
      }),
    );
  });

  it("allows bound tool versions", () => {
    const policy = new RuntimeBindingToolPolicy({
      echo: "tv-1" as ToolVersionId,
    });
    expect(() => policy.authorizeToolInvocation(context)).not.toThrow();
  });
});

describe("DenyingToolPolicy", () => {
  it("always rejects", () => {
    const policy = new DenyingToolPolicy();
    expect(() => policy.authorizeToolInvocation(context)).toThrow(
      ToolGatewayError,
    );
  });
});

describe("WorkspaceScopedToolPolicy", () => {
  it("rejects foreign workspaces", () => {
    const policy = new WorkspaceScopedToolPolicy("ws-b" as WorkspaceId);
    expect(() => policy.authorizeToolInvocation(context)).toThrow(
      expect.objectContaining({
        code: TOOL_ERROR_CODES.TOOL_NOT_AUTHORIZED,
      }),
    );
  });
});
