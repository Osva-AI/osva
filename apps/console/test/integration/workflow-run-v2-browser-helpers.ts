import type { Page } from "playwright";

const WORKFLOW_ID = "wf-v2-browser";
const VERSION_ID = "wv-v2-browser";
export const WORKFLOW_V2_AGENT_ID = "agent-echo-v2";
export const WORKFLOW_V2_AGENT_VERSION_ID = "av-v2-echo-1";

export const BRANCH_DEFINITION = {
  schemaVersion: "3",
  nodes: [
    { key: "route", type: "BRANCH", selector: "/path", defaultTo: "b" },
    {
      key: "a",
      type: "AGENT",
      agentVersionId: WORKFLOW_V2_AGENT_VERSION_ID,
    },
    {
      key: "b",
      type: "AGENT",
      agentVersionId: WORKFLOW_V2_AGENT_VERSION_ID,
    },
  ],
  edges: [
    { from: "route", to: "a" },
    { from: "route", to: "b" },
  ],
};

export const PARALLEL_JOIN_DEFINITION = {
  schemaVersion: "3",
  nodes: [
    { key: "fork", type: "PARALLEL" },
    {
      key: "left",
      type: "AGENT",
      agentVersionId: WORKFLOW_V2_AGENT_VERSION_ID,
    },
    {
      key: "right",
      type: "AGENT",
      agentVersionId: WORKFLOW_V2_AGENT_VERSION_ID,
    },
    { key: "join", type: "JOIN" },
  ],
  edges: [
    { from: "fork", to: "left" },
    { from: "fork", to: "right" },
    { from: "left", to: "join" },
    { from: "right", to: "join" },
  ],
};

export const APPROVAL_DEFINITION = {
  schemaVersion: "3",
  nodes: [
    {
      key: "agent",
      type: "AGENT",
      agentVersionId: WORKFLOW_V2_AGENT_VERSION_ID,
    },
    {
      key: "approval",
      type: "APPROVAL",
      title: "Review before continuing",
      description: "Operator approval gate",
    },
  ],
  edges: [{ from: "agent", to: "approval" }],
};

export const EVENT_WAIT_DEFINITION = {
  schemaVersion: "3",
  nodes: [
    {
      key: "wait-event",
      type: "WAIT",
      wait: {
        kind: "EVENT",
        source: "billing",
        eventType: "invoice.paid",
        correlation: { kind: "LITERAL", value: "inv-v2" },
      },
    },
  ],
  edges: [],
};

export function workflowNodeRun(
  workflowRunId: string,
  overrides: {
    readonly id: string;
    readonly workflowNodeKey: string;
    readonly sequence: number;
    readonly status: string;
    readonly selectedTargetKey?: string;
    readonly childRunId?: string;
  },
): object {
  return {
    workspaceId: "ws-admin",
    workflowRunId,
    input: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:02.000Z",
    startedAt: "2026-01-01T00:00:00.100Z",
    completedAt:
      overrides.status === "SUCCEEDED" ||
      overrides.status === "FAILED" ||
      overrides.status === "SKIPPED"
        ? "2026-01-01T00:00:01.500Z"
        : undefined,
    ...overrides,
  };
}

/** Persisted records for a terminal SUCCEEDED two-step approval workflow. */
export function succeededApprovalPathNodeRuns(workflowRunId: string): object[] {
  return [
    workflowNodeRun(workflowRunId, {
      id: `${workflowRunId}-wn-agent`,
      workflowNodeKey: "agent",
      sequence: 1,
      status: "SUCCEEDED",
      childRunId: `${workflowRunId}-child`,
    }),
    workflowNodeRun(workflowRunId, {
      id: `${workflowRunId}-wn-approval`,
      workflowNodeKey: "approval",
      sequence: 2,
      status: "SUCCEEDED",
    }),
  ];
}

export async function seedWorkflowV2AgentCatalog(page: Page): Promise<void> {
  await page.route("**/api/v1/agents/*/versions", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    const url = route.request().url();
    if (!url.includes(WORKFLOW_V2_AGENT_ID)) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        versions: [
          {
            id: WORKFLOW_V2_AGENT_VERSION_ID,
            agentId: WORKFLOW_V2_AGENT_ID,
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });

  await page.route("**/api/v1/agents", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        agents: [
          {
            id: WORKFLOW_V2_AGENT_ID,
            name: "Echo Browser",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    });
  });
}

export async function routeWorkflowRunV2(
  page: Page,
  workflowRunId: string,
  input: {
    readonly status: string;
    readonly definition: object;
    readonly nodeRuns?: readonly object[];
    readonly approvalRequests?: readonly object[];
    readonly error?: { readonly code: string; readonly message: string };
    readonly output?: unknown;
  },
): Promise<void> {
  await page.route(
    `**/api/v1/workflows/${WORKFLOW_ID}/versions/${VERSION_ID}`,
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: VERSION_ID,
          workflowId: WORKFLOW_ID,
          workspaceId: "ws-admin",
          version: 1,
          definition: input.definition,
          createdAt: "2026-01-01T00:00:00.000Z",
        }),
      });
    },
  );

  await page.route(
    `**/api/v1/workflow-runs/${workflowRunId}`,
    async (route) => {
      if (route.request().method() !== "GET") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: workflowRunId,
          workspaceId: "ws-admin",
          workflowId: WORKFLOW_ID,
          workflowVersionId: VERSION_ID,
          status: input.status,
          input: { scenario: workflowRunId },
          output: input.output,
          error: input.error,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:02.000Z",
          startedAt: "2026-01-01T00:00:00.100Z",
          completedAt:
            input.status === "SUCCEEDED" || input.status === "FAILED"
              ? "2026-01-01T00:00:02.000Z"
              : undefined,
          nodeRuns: input.nodeRuns ?? [],
          approvalRequests: input.approvalRequests ?? [],
        }),
      });
    },
  );

  await page.route("**/api/v1/artifacts?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });
}
