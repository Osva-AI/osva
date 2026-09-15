import { describe, expect, it } from "vitest";

import { Agent } from "../src/agent.js";
import { Deployment } from "../src/deployment.js";
import { DomainInvariantError } from "../src/errors.js";
import { Run } from "../src/run.js";
import { Workspace } from "../src/workspace.js";
import {
  agentId,
  agentVersionId,
  createBindings,
  deploymentId,
  NOW,
  RUN_INPUT,
  runId,
  workspaceId,
} from "./fixtures.js";

describe("Stage 0 identity entities", () => {
  it("creates a Workspace with ownership identity", () => {
    const workspace = Workspace.create({
      id: workspaceId,
      name: "Acme",
      createdAt: NOW,
    });

    expect(workspace.id).toBe(workspaceId);
    expect(workspace.name).toBe("Acme");
    expect(Object.isFrozen(workspace)).toBe(true);
  });

  it("creates an Agent as logical identity, not executable code", () => {
    const agent = Agent.create({
      id: agentId,
      workspaceId,
      key: "example-agent",
      name: "Example Agent",
      createdAt: NOW,
    });

    expect(agent.workspaceId).toBe(workspaceId);
    expect(agent.key).toBe("example-agent");
    expect(Object.isFrozen(agent)).toBe(true);
  });

  it("creates a Deployment that pins an AgentVersion", () => {
    const deployment = Deployment.create({
      id: deploymentId,
      workspaceId,
      agentId,
      agentVersionId,
      environment: "dev",
      createdAt: NOW,
    });

    expect(deployment.agentVersionId).toBe(agentVersionId);
    expect(deployment.environment).toBe("dev");
    expect(Object.isFrozen(deployment)).toBe(true);
  });

  it("creates a Run with immutable effective bindings and no public setStatus", () => {
    const run = Run.create({
      id: runId,
      workspaceId,
      agentId,
      effectiveBindings: createBindings(),
      input: RUN_INPUT,
      createdAt: NOW,
    });

    expect(run.status).toBe("PENDING");
    expect(run.input).toEqual(RUN_INPUT);
    expect(run.effectiveBindings.agentVersionId).toBe(agentVersionId);
    expect(run).not.toHaveProperty("setStatus");
    expect(Object.isFrozen(run)).toBe(true);
  });

  it("rejects non-JSON-compatible Run input", () => {
    expect(() =>
      Run.create({
        id: runId,
        workspaceId,
        agentId,
        effectiveBindings: createBindings(),
        input: () => "nope",
        createdAt: NOW,
      }),
    ).toThrow(DomainInvariantError);
  });

  it("rejects a blank Agent key", () => {
    expect(() =>
      Agent.create({
        id: agentId,
        workspaceId,
        key: " ",
        name: "Example Agent",
        createdAt: NOW,
      }),
    ).toThrow(DomainInvariantError);
  });
});
