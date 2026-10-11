import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkflowRunDetailPage } from "../src/client/routes/workflow-run-detail-page";

const definition = {
  schemaVersion: "3",
  nodes: [
    {
      key: "agent",
      type: "AGENT",
      agentVersionId: "av-1",
    },
    {
      key: "approval",
      type: "APPROVAL",
      title: "Review output",
      description: "Check before continuing",
    },
    {
      key: "wait-event",
      type: "WAIT",
      wait: {
        kind: "EVENT",
        source: "billing",
        eventType: "invoice.paid",
        correlation: { kind: "LITERAL", value: "inv-1" },
      },
    },
  ],
  edges: [
    { from: "agent", to: "approval" },
    { from: "approval", to: "wait-event" },
  ],
};

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/workflow-runs/wr-1"]}>
        <Routes>
          <Route
            path="/workflow-runs/:workflowRunId"
            element={<WorkflowRunDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WorkflowRunDetailPage", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("combines definition and node runs with operator actions", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/auth/context")) {
        return new Response(
          JSON.stringify({
            subjectId: "sub-1",
            workspaceId: "ws-1",
            role: "OPERATOR",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/workflows/wf-1/versions/wv-1")) {
        return new Response(
          JSON.stringify({
            id: "wv-1",
            workflowId: "wf-1",
            workspaceId: "ws-1",
            version: 1,
            definition,
            createdAt: "2026-01-01T00:00:00.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (
        url.includes("/api/v1/approval-requests/ar-1/decision") &&
        init?.method === "POST"
      ) {
        return new Response(
          JSON.stringify({
            id: "ar-1",
            workspaceId: "ws-1",
            workflowRunId: "wr-1",
            workflowNodeRunId: "wn-2",
            status: "APPROVED",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/workflow-runs/wr-1")) {
        return new Response(
          JSON.stringify({
            id: "wr-1",
            workspaceId: "ws-1",
            workflowId: "wf-1",
            workflowVersionId: "wv-1",
            status: "WAITING",
            input: { invoiceId: "inv-1" },
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
            nodeRuns: [
              {
                id: "wn-1",
                workspaceId: "ws-1",
                workflowRunId: "wr-1",
                workflowNodeKey: "agent",
                sequence: 1,
                status: "SUCCEEDED",
                input: {},
                childRunId: "run-child-1",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:01.000Z",
              },
              {
                id: "wn-2",
                workspaceId: "ws-1",
                workflowRunId: "wr-1",
                workflowNodeKey: "approval",
                sequence: 2,
                status: "WAITING",
                input: {},
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:01.000Z",
              },
              {
                id: "wn-3",
                workspaceId: "ws-1",
                workflowRunId: "wr-1",
                workflowNodeKey: "wait-event",
                sequence: 3,
                status: "PENDING",
                input: {},
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:01.000Z",
              },
            ],
            approvalRequests: [
              {
                id: "ar-1",
                workspaceId: "ws-1",
                workflowRunId: "wr-1",
                workflowNodeRunId: "wn-2",
                status: "PENDING",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:01.000Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderDetail();

    await waitFor(() => {
      expect(screen.getAllByText("Review output").length).toBeGreaterThan(0);
    });
    expect(
      screen.getByRole("link", { name: /run-child-1/ }).getAttribute("href"),
    ).toBe("/runs/run-child-1");
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Emit event" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).includes("/decision") && init?.method === "POST",
        ),
      ).toBe(true);
    });
  });

  it("shows emit event for waiting EVENT node and preserves request id on failure", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/auth/context")) {
        return new Response(
          JSON.stringify({
            subjectId: "sub-1",
            workspaceId: "ws-1",
            role: "ADMIN",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/workflows/wf-1/versions/wv-1")) {
        return new Response(
          JSON.stringify({
            id: "wv-1",
            workflowId: "wf-1",
            workspaceId: "ws-1",
            version: 1,
            definition,
            createdAt: "2026-01-01T00:00:00.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/workflow-events") && init?.method === "POST") {
        return new Response(
          JSON.stringify({ error: "conflict", requestId: "req-event-9" }),
          {
            status: 409,
            headers: {
              "Content-Type": "application/json",
              "x-osva-request-id": "req-event-9",
            },
          },
        );
      }
      if (url.includes("/api/v1/workflow-runs/wr-1")) {
        return new Response(
          JSON.stringify({
            id: "wr-1",
            workspaceId: "ws-1",
            workflowId: "wf-1",
            workflowVersionId: "wv-1",
            status: "WAITING",
            input: {},
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
            nodeRuns: [
              {
                id: "wn-3",
                workspaceId: "ws-1",
                workflowRunId: "wr-1",
                workflowNodeKey: "wait-event",
                sequence: 3,
                status: "WAITING",
                input: {},
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:01.000Z",
              },
            ],
            approvalRequests: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderDetail();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Emit event" })).toBeTruthy();
    });
    expect((screen.getByLabelText("Source") as HTMLInputElement).value).toBe(
      "billing",
    );
    expect(
      (screen.getByLabelText("Correlation key") as HTMLInputElement).value,
    ).toBe("inv-1");
    expect(
      screen.getByText(/does not force-resume the workflow/i),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Emit event" }));
    await waitFor(() => {
      expect(screen.getByText(/Request ID: req-event-9/)).toBeTruthy();
    });
  });
});
