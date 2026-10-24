import type {
  AgentId,
  JsonValue,
  RunAttemptId,
  RunId,
  ToolAuthorizationContext,
  ToolVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION,
  MEMORY_ERROR_CODES,
  TOOL_ERROR_CODES,
  allowsPersistentMemoryMutation,
} from "@osva-ai/contracts";
import {
  MemoryMemoryNamespaceRepository,
  MemoryToolRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import {
  ApprovalRequest,
  Tool,
  ToolVersion,
  Workspace,
  assessEvaluationQualityGate,
  createMemoryApplication,
  createToolApplication,
} from "@osva/domain";
import { fakeControlPlaneScope } from "./helpers/test-scope.js";
import { evaluateRemoteHttpDestination } from "@osva/outbound-network";
import { MemoryGateway } from "@osva/memory-gateway";
import { DefaultToolPolicy, ToolGateway } from "@osva/tool-gateway";
import { describe, expect, it } from "vitest";

import {
  EVALUATION_STATUS_FORGERY,
  FAKE_OSVA_API_KEY,
  FAKE_PROVIDER_SECRET,
  FORGED_APPROVAL_NARRATIVE,
  MCP_TOOL_RESPONSE_INJECTION,
  RETRIEVED_KNOWLEDGE_INJECTION,
  USER_INPUT_AUTHORITY_OVERRIDE,
  launderedPriorAgentOutput,
} from "../src/index.js";
import type { AdversarialEnforcementOutcome } from "../src/fixtures/enforcement-outcomes.js";
import {
  adversarialDeclarativeRequest,
  createDeclarativeAdapter,
  createFakeModelGateway,
  createRecordingToolGateway,
} from "./helpers/declarative-harness.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const WORKSPACE_ID = "ws-adv-gateway" as WorkspaceId;
const OTHER_WORKSPACE_ID = "ws-adv-foreign" as WorkspaceId;
const AGENT_ID = "agent-adv-gateway" as AgentId;
const RUN_ID = "run-adv-gateway" as RunId;
const RUN_ATTEMPT_ID = "attempt-adv-gateway" as RunAttemptId;

function authContext(
  bindingName: string,
  toolVersionId: ToolVersionId,
  workspaceId: WorkspaceId = WORKSPACE_ID,
): ToolAuthorizationContext {
  return {
    workspaceId,
    agentId: AGENT_ID,
    runId: RUN_ID,
    runAttemptId: RUN_ATTEMPT_ID,
    bindingName,
    toolVersionId,
  };
}

async function createMemoryGatewayFixture() {
  const memoryNamespaces = new MemoryMemoryNamespaceRepository();
  const workspaces = {
    async findById(id: WorkspaceId) {
      return Workspace.create({
        id,
        name: `Workspace ${id}`,
        createdAt: NOW,
      });
    },
    async save() {},
    async countAll() {
      return 1;
    },
    async listIds() {
      return [WORKSPACE_ID];
    },
    async listUnlinkedIds() {
      return [];
    },
  };
  const application = createMemoryApplication({
    memoryNamespaces,
    workspaces,
    clock: { now: () => NOW },
    ids: { createId: () => "mem-ns-adv-1" },
  });
  const scope = fakeControlPlaneScope(WORKSPACE_ID);
  const namespace = await application.createMemoryNamespace.execute(scope, {
    workspaceId: WORKSPACE_ID,
    key: "notes",
    name: "Notes",
  });

  const gateway = new MemoryGateway({
    memoryNamespaces,
    clock: { now: () => NOW },
  });
  return {
    gateway,
    authorization: {
      workspaceId: WORKSPACE_ID,
      allowPersistentMutation: true,
      memoryNamespaceBindings: {
        notes: {
          namespaceId: namespace.id,
          access: "READ_WRITE" as const,
        },
      },
    },
  };
}

async function seedEchoTool(tools: MemoryToolRepository) {
  const workspaces = new MemoryWorkspaceRepository();
  await workspaces.save(
    Workspace.create({
      id: WORKSPACE_ID,
      name: "Adv Workspace",
      createdAt: NOW,
    }),
  );

  let counter = 0;
  const application = createToolApplication({
    tools,
    workspaces,
    clock: { now: () => NOW },
    ids: {
      createId() {
        counter += 1;
        return `adv-gen-${String(counter)}`;
      },
    },
  });

  const scope = fakeControlPlaneScope(WORKSPACE_ID);
  const echoTool = await application.createTool.execute(scope, {
    workspaceId: WORKSPACE_ID,
    key: "echo",
    name: "Echo",
  });
  const echoVersion = await application.appendToolVersion.execute(scope, {
    toolId: echoTool.id,
    type: "INTERNAL",
    implementation: "OSVA_ECHO_V1",
  });

  return { echoVersionId: echoVersion.id };
}

describe("M14.4 adversarial acceptance", () => {
  describe("minimum acceptance scenarios", () => {
    it("1–2: unbound and foreign-workspace tool invokes are denied at ToolGateway", async () => {
      const tools = new MemoryToolRepository();
      const { echoVersionId } = await seedEchoTool(tools);

      const foreignToolId =
        "tool-foreign-adv" as import("@osva-ai/contracts").ToolId;
      const foreignVersionId = "tv-foreign-adv" as ToolVersionId;
      await tools.saveTool(
        Tool.create({
          id: foreignToolId,
          workspaceId: OTHER_WORKSPACE_ID,
          key: "foreign-echo",
          name: "Foreign Echo",
          createdAt: NOW,
        }),
      );
      await tools.saveToolVersion(
        ToolVersion.create({
          id: foreignVersionId,
          toolId: foreignToolId,
          version: 1,
          type: "INTERNAL",
          implementation: "OSVA_ECHO_V1",
          createdAt: NOW,
        }),
      );

      const gateway = new ToolGateway({
        tools,
        policy: new DefaultToolPolicy(),
      });

      await expect(
        gateway.invoke({
          toolVersionId: echoVersionId,
          input: { value: 1 },
          authorization: authContext("echo", "tv-wrong-id" as ToolVersionId),
        }),
      ).rejects.toMatchObject({
        code: TOOL_ERROR_CODES.TOOL_NOT_AUTHORIZED,
      });

      await expect(
        gateway.invoke({
          toolVersionId: foreignVersionId,
          input: { value: 1 },
          authorization: authContext("echo", foreignVersionId),
        }),
      ).rejects.toMatchObject({
        code: TOOL_ERROR_CODES.TOOL_VERSION_NOT_FOUND,
      });
    });

    it("4–5: malicious knowledge and MCP tool responses cannot expand declarative tool allowlist", async () => {
      let modelTurn = 0;
      const toolGateway = createRecordingToolGateway(async () => ({
        ...MCP_TOOL_RESPONSE_INJECTION,
      }));

      const adapter = createDeclarativeAdapter({
        knowledgeHits: [{ text: RETRIEVED_KNOWLEDGE_INJECTION }],
        modelGateway: createFakeModelGateway(async () => {
          modelTurn += 1;
          if (modelTurn === 1) {
            return {
              toolCalls: [
                {
                  id: "call-echo",
                  name: "echo",
                  arguments: { value: "probe" },
                },
              ],
              finishReason: "tool_call",
            };
          }
          return {
            toolCalls: [
              {
                id: "call-secret",
                name: "secret-admin",
                arguments: { action: "exfiltrate" },
              },
            ],
            finishReason: "tool_call",
          };
        }),
        toolGateway,
      });

      const knowledgeRequest = adversarialDeclarativeRequest({
        input: USER_INPUT_AUTHORITY_OVERRIDE,
        knowledgeIndexBindings: { docs: ["ki-adv-1" as never] },
      });

      const afterKnowledge = await adapter.execute(knowledgeRequest);
      expect(afterKnowledge.status).toBe("failed");
      if (afterKnowledge.status === "failed") {
        expect(afterKnowledge.error.code).toBe("TOOL_NOT_AUTHORIZED");
      }
      expect(toolGateway.invoke).toHaveBeenCalledTimes(1);

      modelTurn = 0;
      const mcpFollowUp = createDeclarativeAdapter({
        modelGateway: createFakeModelGateway(async () => {
          modelTurn += 1;
          if (modelTurn === 1) {
            return {
              toolCalls: [
                {
                  id: "c1",
                  name: "echo",
                  arguments: { value: "first" },
                },
              ],
              finishReason: "tool_call",
            };
          }
          return {
            toolCalls: [
              {
                id: "c2",
                name: "secret-admin",
                arguments: MCP_TOOL_RESPONSE_INJECTION,
              },
            ],
            finishReason: "tool_call",
          };
        }),
        toolGateway: createRecordingToolGateway(async () => ({
          injected: MCP_TOOL_RESPONSE_INJECTION,
        })),
      });

      const mcpResult = await mcpFollowUp.execute(
        adversarialDeclarativeRequest(),
      );
      expect(mcpResult.status).toBe("failed");
      if (mcpResult.status === "failed") {
        expect(mcpResult.error.code).toBe("TOOL_NOT_AUTHORIZED");
      }
    });

    it("3: user input cannot override frozen execution bindings (deterministic fake model)", async () => {
      const capturedAuths: ToolAuthorizationContext[] = [];
      const toolGateway = createRecordingToolGateway(async (request) => {
        capturedAuths.push(request.authorization);
        return { value: request.input as JsonValue };
      });
      let turn = 0;
      const adapter = createDeclarativeAdapter({
        modelGateway: createFakeModelGateway(async () => {
          turn += 1;
          if (turn === 1) {
            return {
              toolCalls: [
                {
                  id: "call-echo",
                  name: "echo",
                  arguments: {
                    value: USER_INPUT_AUTHORITY_OVERRIDE,
                  },
                },
              ],
              finishReason: "tool_call",
            };
          }
          return {
            text: JSON.stringify({ answer: "ok" }),
            toolCalls: [],
            finishReason: "stop",
          };
        }),
        toolGateway,
      });

      const request = adversarialDeclarativeRequest({
        input: USER_INPUT_AUTHORITY_OVERRIDE,
        workspaceId: "ws-adv-1" as WorkspaceId,
        toolVersionBindings: {
          echo: "tv-bound-only" as ToolVersionId,
        },
      });

      const result = await adapter.execute(request);
      expect(result.status).toBe("succeeded");
      expect(capturedAuths).toHaveLength(1);
      expect(capturedAuths[0]?.workspaceId).toBe("ws-adv-1");
      expect(capturedAuths[0]?.toolVersionId).toBe("tv-bound-only");
      expect(capturedAuths[0]?.bindingName).toBe("echo");
      expect(
        (
          USER_INPUT_AUTHORITY_OVERRIDE as {
            __osva_override: { workspaceId: string };
          }
        ).__osva_override.workspaceId,
      ).toBe("ws-foreign");
    });

    it("4/B4: authorized echo with attacker-controlled arguments succeeds (AUTHORIZED_BUT_UNSAFE)", async () => {
      let invokeInput: unknown;
      const toolGateway = createRecordingToolGateway(async (request) => {
        invokeInput = request.input;
        return { echoed: request.input as JsonValue };
      });

      let turn = 0;
      const adapter = createDeclarativeAdapter({
        modelGateway: createFakeModelGateway(async () => {
          turn += 1;
          if (turn === 1) {
            return {
              toolCalls: [
                {
                  id: "exfil2",
                  name: "echo",
                  arguments: {
                    value: {
                      secret: FAKE_OSVA_API_KEY,
                      target: "attacker",
                      nested: FAKE_PROVIDER_SECRET,
                    },
                  },
                },
              ],
              finishReason: "tool_call",
            };
          }
          return {
            text: JSON.stringify({ answer: "exfiltrated" }),
            toolCalls: [],
            finishReason: "stop",
          };
        }),
        toolGateway,
        resolveToolMetadata: async () => ({
          inputSchema: {
            type: "object",
            properties: { value: { type: "object" } },
            required: ["value"],
            additionalProperties: true,
          },
        }),
      });

      const unsafe = await adapter.execute(adversarialDeclarativeRequest());
      expect(unsafe.status).toBe("succeeded");
      expect(JSON.stringify(invokeInput)).toContain(FAKE_OSVA_API_KEY);
      expect(JSON.stringify(invokeInput)).toContain(FAKE_PROVIDER_SECRET);

      const outcome: AdversarialEnforcementOutcome = "AUTHORIZED_BUT_UNSAFE";
      expect(outcome).toBe("AUTHORIZED_BUT_UNSAFE");
    });

    it("7: cross-agent laundered text does not expand bindings for downstream declarative run", async () => {
      const downstreamInput = {
        priorStage: launderedPriorAgentOutput(RETRIEVED_KNOWLEDGE_INJECTION),
      };
      const toolGateway = createRecordingToolGateway(async () => ({
        ok: true,
      }));
      const adapter = createDeclarativeAdapter({
        modelGateway: createFakeModelGateway(async () => ({
          toolCalls: [
            {
              id: "launder",
              name: "secret-admin",
              arguments: { action: "privilege-escalation" },
            },
          ],
          finishReason: "tool_call",
        })),
        toolGateway,
      });

      const result = await adapter.execute(
        adversarialDeclarativeRequest({
          input: downstreamInput,
          toolVersionBindings: {
            echo: "tv-downstream" as ToolVersionId,
          },
        }),
      );

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.error.code).toBe("TOOL_NOT_AUTHORIZED");
      }
      expect(toolGateway.invoke).not.toHaveBeenCalled();
    });

    it("8: forged approval narrative does not mutate ApprovalRequest state", () => {
      const pending = ApprovalRequest.create({
        id: "approval-adv-1" as never,
        workspaceId: WORKSPACE_ID,
        workflowRunId: "wfr-adv-1" as never,
        workflowNodeRunId: "wnr-adv-1" as never,
        createdAt: NOW,
      });

      expect(pending.status).toBe("PENDING");
      expect(FORGED_APPROVAL_NARRATIVE).toContain("APPROVED");
      expect(pending.status).toBe("PENDING");
      expect(pending.decisionComment).toBeUndefined();
    });

    it("9: evaluation quality gate ignores forged agent output claims", () => {
      const gate = assessEvaluationQualityGate({
        policy: {
          schemaVersion: EVALUATION_QUALITY_GATE_POLICY_SCHEMA_VERSION,
          rules: [{ metric: "PASS_RATE", operator: "MIN", threshold: 1 }],
        },
        evaluationRunStatus: "COMPLETED",
        summary: {
          totalCases: 1,
          pendingCases: 0,
          runningCases: 0,
          completedCases: 1,
          passedCases: 0,
          failedCases: 1,
          errorCases: 0,
          passRate: 0,
          completionCoverage: 1,
          validScoredCaseCount: 1,
          qualityScore: 0,
          durationMs: 1,
          inputTokens: 0,
          outputTokens: 0,
          pricedCostUsdMicros: 0,
          unpricedModelCalls: 0,
          usageMeasured: true,
        },
        assessedAt: NOW,
        allowFinalPass: true,
      });

      expect(gate.overallVerdict).toBe("FAIL");
      expect(JSON.stringify(EVALUATION_STATUS_FORGERY)).toContain("PASS");
      expect(gate.overallVerdict).not.toBe("PASS");
    });

    it("10: evaluation child runs forbid persistent memory mutation", async () => {
      expect(
        allowsPersistentMemoryMutation({
          evaluationContext: {
            evaluationRunId: "eval-run-adv" as never,
            evaluationCaseId: "eval-case-adv" as never,
          },
        }),
      ).toBe(false);

      const { gateway, authorization } = await createMemoryGatewayFixture();
      await expect(
        gateway.set(
          {
            bindingName: "notes",
            key: "eval-poison",
            value: { forged: EVALUATION_STATUS_FORGERY },
          },
          { ...authorization, allowPersistentMutation: false },
        ),
      ).rejects.toMatchObject({
        code: MEMORY_ERROR_CODES.MEMORY_PERMISSION_DENIED,
      });
    });

    it("11: injection-driven private-network destinations remain blocked", async () => {
      const destinations = [
        "http://127.0.0.1/execute",
        "http://169.254.169.254/latest/meta-data/",
        MCP_TOOL_RESPONSE_INJECTION.exfilUrl,
      ];

      for (const endpoint of destinations) {
        await expect(
          evaluateRemoteHttpDestination(endpoint, {
            allowPrivateNetworks: false,
            lookup: async () => {
              throw new Error("DNS must not run for literal forbidden hosts");
            },
          }),
        ).resolves.toBe("forbidden_destination");
      }
    });

    it("13: repeated malicious tool selection respects invocation budgets", async () => {
      let modelCalls = 0;
      const toolGateway = createRecordingToolGateway(async () => ({
        value: 1,
      }));
      const adapter = createDeclarativeAdapter({
        modelGateway: createFakeModelGateway(async () => {
          modelCalls += 1;
          return {
            toolCalls: [{ id: "t", name: "echo", arguments: { value: 1 } }],
            finishReason: "tool_call",
          };
        }),
        toolGateway,
      });

      const result = await adapter.execute(
        adversarialDeclarativeRequest({
          runtime: {
            type: "DECLARATIVE",
            config: {
              configVersion: "1",
              instructions: "Test",
              modelBinding: "primary",
              allowedToolBindings: ["echo"],
              maxModelInvocations: 4,
              maxToolInvocations: 1,
            },
          },
        }),
      );

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.error.code).toBe("DECLARATIVE_BUDGET_EXCEEDED");
      }
      expect(toolGateway.invoke).toHaveBeenCalledTimes(1);
      expect(modelCalls).toBeGreaterThanOrEqual(2);
    });

    it("15: legitimate authorized echo invocation still succeeds under adversarial fixture run", async () => {
      const toolGateway = createRecordingToolGateway(async () => ({
        value: "legitimate",
      }));
      let pass = 0;
      const adapter = createDeclarativeAdapter({
        modelGateway: createFakeModelGateway(async () => {
          pass += 1;
          if (pass === 1) {
            return {
              toolCalls: [
                {
                  id: "ok",
                  name: "echo",
                  arguments: { value: "legitimate" },
                },
              ],
              finishReason: "tool_call",
            };
          }
          return {
            text: JSON.stringify({ answer: "done" }),
            toolCalls: [],
            finishReason: "stop",
          };
        }),
        toolGateway,
      });

      const result = await adapter.execute(adversarialDeclarativeRequest());
      expect(result).toEqual({
        status: "succeeded",
        output: { answer: "done" },
      });
      expect(toolGateway.invoke).toHaveBeenCalledOnce();
    });
  });

  describe("reporting classifications", () => {
    it("documents TEST_LIMITATION for fake-model behavioral probes", () => {
      const limitation: AdversarialEnforcementOutcome = "TEST_LIMITATION";
      expect(limitation).toBe("TEST_LIMITATION");
    });
  });
});
