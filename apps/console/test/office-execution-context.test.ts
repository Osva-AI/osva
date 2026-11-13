import { describe, expect, it } from "vitest";

import {
  agentVersionIndexFromCatalog,
  buildOfficeAssignmentExecutionContext,
  buildWorkerAssignmentActivityRows,
} from "../src/client/lib/office-execution-context";
import type {
  OfficeAssignmentResource,
  OfficeWorkerResource,
} from "../src/client/hooks/use-office";
import type { WorkflowRunResource } from "../src/client/hooks/use-workflow-runs";
import type { RunResource } from "../src/client/hooks/use-runs";

const worker: OfficeWorkerResource = {
  id: "ow-1",
  workspaceId: "ws-1",
  key: "writer",
  name: "Writer",
  agentId: "agent-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("console office execution context adapter", () => {
  it("builds agent-backed context without triggering side effects", () => {
    const assignment: OfficeAssignmentResource = {
      id: "asn-1",
      workspaceId: "ws-1",
      officeWorkerId: worker.id,
      title: "Agent task",
      targetType: "AGENT_VERSION",
      targetVersionId: "av-1",
      input: {},
      status: "RUNNING",
      runId: "run-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:01:00.000Z",
    };
    const run: RunResource = {
      id: "run-1",
      agentId: "agent-1",
      status: "RUNNING",
      effectiveBindings: {
        agentVersionId: "av-1",
        modelProfileVersionBindings: {},
        toolVersionBindings: {},
      },
      input: {},
      createdAt: "2026-01-01T00:01:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z",
    };

    const context = buildOfficeAssignmentExecutionContext({
      assignment,
      officeWorker: worker,
      run,
      workers: [worker],
    });

    expect(context?.kind).toBe("AGENT_RUN");
    if (context?.kind === "AGENT_RUN") {
      expect(context.runId).toBe("run-1");
    }
  });

  it("builds workflow timeline entries from workflow run payload", () => {
    const assignment: OfficeAssignmentResource = {
      id: "asn-wf",
      workspaceId: "ws-1",
      officeWorkerId: worker.id,
      title: "Workflow task",
      targetType: "WORKFLOW_VERSION",
      targetVersionId: "wv-1",
      input: {},
      status: "RUNNING",
      workflowRunId: "wfr-1",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const workflowRun: WorkflowRunResource = {
      id: "wfr-1",
      workspaceId: "ws-1",
      workflowId: "wf-1",
      workflowVersionId: "wv-1",
      status: "RUNNING",
      input: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
      nodeRuns: [
        {
          id: "nr-1",
          workspaceId: "ws-1",
          workflowRunId: "wfr-1",
          workflowNodeKey: "step-a",
          sequence: 1,
          status: "SUCCEEDED",
          input: {},
          childRunId: "child-1",
          createdAt: "2026-01-01T00:01:00.000Z",
          updatedAt: "2026-01-01T00:02:00.000Z",
        },
      ],
      approvalRequests: [],
    };

    const workflowDefinition = {
      schemaVersion: "3",
      nodes: [{ key: "step-a", type: "AGENT", agentVersionId: "av-1" }],
      edges: [],
    };

    const context = buildOfficeAssignmentExecutionContext({
      assignment,
      officeWorker: worker,
      workflowRun,
      workflowDefinition,
      workers: [worker],
      agentVersionCatalog: {
        entries: [
          {
            agentId: "agent-1",
            versions: [
              {
                id: "av-1",
                agentId: "agent-1",
                version: 1,
                manifest: { schemaVersion: "1", key: "echo-agent" },
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          },
        ],
      },
    });

    expect(context?.kind).toBe("WORKFLOW_RUN");
    if (context?.kind === "WORKFLOW_RUN") {
      expect(context.timeline[0]?.childRunId).toBe("child-1");
      expect(context.timeline[0]?.workerAttribution.kind).toBe("RESOLVED");
    }
  });

  it("filters worker assignment activity rows", () => {
    const rows = buildWorkerAssignmentActivityRows({
      workspaceId: "ws-1",
      officeWorkerId: "ow-1",
      assignments: [
        {
          id: "asn-1",
          workspaceId: "ws-1",
          officeWorkerId: "ow-1",
          title: "One",
          targetType: "AGENT_VERSION",
          targetVersionId: "av-1",
          input: {},
          status: "COMPLETED",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "asn-2",
          workspaceId: "ws-1",
          officeWorkerId: "ow-2",
          title: "Other worker",
          targetType: "AGENT_VERSION",
          targetVersionId: "av-1",
          input: {},
          status: "PENDING",
          createdAt: "2026-01-03T00:00:00.000Z",
        },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.assignmentId).toBe("asn-1");
  });

  it("indexes agent versions from catalog", () => {
    const map = agentVersionIndexFromCatalog({
      entries: [
        {
          agentId: "agent-1",
          versions: [
            {
              id: "av-1",
              agentId: "agent-1",
              version: 1,
              manifest: { schemaVersion: "1", key: "echo-agent" },
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
    });

    expect(map.get("av-1" as never)?.agentId).toBe("agent-1");
  });
});
