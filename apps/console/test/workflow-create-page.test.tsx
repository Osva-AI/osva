import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkflowCreatePage } from "../src/client/routes/workflow-create-page";
import {
  addAgentNode,
  createEmptyWorkflowBuilderDraft,
  setAgentNodeVersion,
  updateRegistry,
} from "../src/client/lib/workflow-builder-linear";
import { writeStoredWorkflowBuilderDraft } from "../src/client/lib/workflow-builder-storage";

function renderCreatePage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/workflows/new"]}>
        <Routes>
          <Route path="/workflows/new" element={<WorkflowCreatePage />} />
          <Route
            path="/workflows/:workflowId/versions/:workflowVersionId"
            element={<div>Published version</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Workflow create page", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("discovers agents and publishes workflow then version", async () => {
    const user = userEvent.setup();
    let createCalls = 0;
    let versionCalls = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.includes("/api/v1/auth/context")) {
          return Response.json({
            subjectId: "sub-1",
            workspaceId: "ws-1",
            role: "ADMIN",
          });
        }
        if (url.includes("/api/v1/agents") && !url.includes("/versions")) {
          return Response.json({
            agents: [
              {
                id: "agent-1",
                workspaceId: "ws-1",
                key: "demo",
                name: "Demo Agent",
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          });
        }
        if (url.includes("/api/v1/agents/agent-1/versions")) {
          return Response.json({
            versions: [
              {
                id: "av-1",
                agentId: "agent-1",
                version: 1,
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          });
        }
        if (url.endsWith("/api/v1/workflows") && method === "POST") {
          createCalls += 1;
          return Response.json(
            {
              id: "wf-1",
              workspaceId: "ws-1",
              key: "demo-wf",
              name: "Demo WF",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            { status: 201 },
          );
        }
        if (
          url.includes("/api/v1/workflows/wf-1/versions") &&
          method === "POST"
        ) {
          versionCalls += 1;
          return Response.json(
            {
              id: "wv-1",
              workflowId: "wf-1",
              workspaceId: "ws-1",
              version: 1,
              definition: { schemaVersion: "3", nodes: [], edges: [] },
              createdAt: "2026-01-01T00:00:00.000Z",
            },
            { status: 201 },
          );
        }
        return Response.json({}, { status: 404 });
      }),
    );

    renderCreatePage();
    await waitFor(() => {
      expect(screen.getByLabelText("Key")).toBeTruthy();
    });

    await user.type(screen.getByLabelText("Key"), "demo-wf");
    await user.type(screen.getByLabelText("Name"), "Demo WF");
    await user.click(screen.getByRole("button", { name: "Add step" }));
    await user.selectOptions(screen.getByLabelText("Agent"), "agent-1");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent version (immutable)")).toBeTruthy();
    });
    await user.selectOptions(
      screen.getByLabelText("Agent version (immutable)"),
      "av-1",
    );
    await user.click(
      screen.getByRole("button", {
        name: "Create workflow and publish version",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Published version")).toBeTruthy();
    });
    expect(createCalls).toBe(1);
    expect(versionCalls).toBe(1);
  });

  it("retries version publish without recreating workflow", async () => {
    const user = userEvent.setup();
    let createCalls = 0;
    let versionCalls = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.includes("/api/v1/auth/context")) {
          return Response.json({
            subjectId: "sub-1",
            workspaceId: "ws-1",
            role: "ADMIN",
          });
        }
        if (url.includes("/api/v1/agents") && !url.includes("/versions")) {
          return Response.json({
            agents: [
              {
                id: "agent-1",
                workspaceId: "ws-1",
                key: "demo",
                name: "Demo Agent",
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          });
        }
        if (url.includes("/api/v1/agents/agent-1/versions")) {
          return Response.json({
            versions: [
              {
                id: "av-1",
                agentId: "agent-1",
                version: 1,
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          });
        }
        if (url.endsWith("/api/v1/workflows") && method === "POST") {
          createCalls += 1;
          return Response.json(
            {
              id: "wf-partial",
              workspaceId: "ws-1",
              key: "partial",
              name: "Partial",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            { status: 201 },
          );
        }
        if (
          url.includes("/api/v1/workflows/wf-partial/versions") &&
          method === "POST"
        ) {
          versionCalls += 1;
          if (versionCalls === 1) {
            return Response.json(
              { error: "Invalid definition.", code: "invalid_request" },
              { status: 400, headers: { "x-osva-request-id": "req-fail-1" } },
            );
          }
          return Response.json(
            {
              id: "wv-2",
              workflowId: "wf-partial",
              workspaceId: "ws-1",
              version: 1,
              definition: { schemaVersion: "3", nodes: [], edges: [] },
              createdAt: "2026-01-01T00:00:00.000Z",
            },
            { status: 201 },
          );
        }
        return Response.json({}, { status: 404 });
      }),
    );

    renderCreatePage();
    await waitFor(() => {
      expect(screen.getByLabelText("Key")).toBeTruthy();
    });

    await user.type(screen.getByLabelText("Key"), "partial");
    await user.type(screen.getByLabelText("Name"), "Partial");
    await user.click(screen.getByRole("button", { name: "Add step" }));
    await user.selectOptions(screen.getByLabelText("Agent"), "agent-1");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent version (immutable)")).toBeTruthy();
    });
    await user.selectOptions(
      screen.getByLabelText("Agent version (immutable)"),
      "av-1",
    );
    await user.click(
      screen.getByRole("button", {
        name: "Create workflow and publish version",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText(/Request ID: req-fail-1/)).toBeTruthy();
    });
    expect(createCalls).toBe(1);
    expect(versionCalls).toBe(1);

    await user.click(
      screen.getByRole("button", { name: "Retry publish version" }),
    );
    await waitFor(() => {
      expect(screen.getByText("Published version")).toBeTruthy();
    });
    expect(createCalls).toBe(1);
    expect(versionCalls).toBe(2);
  });

  it("restores saved draft with agent and version selectors populated", async () => {
    const user = userEvent.setup();
    let storedDraft = updateRegistry(
      addAgentNode(createEmptyWorkflowBuilderDraft("ws-1")),
      { key: "saved-wf", name: "Saved WF" },
    );
    storedDraft = setAgentNodeVersion(
      storedDraft,
      storedDraft.nodeOrder[0]!,
      "av-1" as import("@osva-ai/contracts").AgentVersionId,
    );
    writeStoredWorkflowBuilderDraft(storedDraft);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/v1/auth/context")) {
          return Response.json({
            subjectId: "sub-1",
            workspaceId: "ws-1",
            role: "ADMIN",
          });
        }
        if (url.includes("/api/v1/agents") && !url.includes("/versions")) {
          return Response.json({
            agents: [
              {
                id: "agent-1",
                workspaceId: "ws-1",
                key: "demo",
                name: "Demo Agent",
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          });
        }
        if (url.includes("/api/v1/agents/agent-1/versions")) {
          return Response.json({
            versions: [
              {
                id: "av-1",
                agentId: "agent-1",
                version: 1,
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          });
        }
        return Response.json({}, { status: 404 });
      }),
    );

    renderCreatePage();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Restore saved draft" }),
      ).toBeTruthy();
    });
    await user.click(
      screen.getByRole("button", { name: "Restore saved draft" }),
    );

    await waitFor(() => {
      const agentSelect = screen.getByLabelText("Agent") as HTMLSelectElement;
      expect(agentSelect.value).toBe("agent-1");
    });
    await waitFor(() => {
      const versionSelect = screen.getByLabelText(
        "Agent version (immutable)",
      ) as HTMLSelectElement;
      expect(versionSelect.value).toBe("av-1");
    });
  });

  it("shows unavailable binding when restored version is not in workspace", async () => {
    const user = userEvent.setup();
    let storedDraft = updateRegistry(
      addAgentNode(createEmptyWorkflowBuilderDraft("ws-1")),
      { key: "saved-wf", name: "Saved WF" },
    );
    storedDraft = setAgentNodeVersion(
      storedDraft,
      storedDraft.nodeOrder[0]!,
      "av-missing" as import("@osva-ai/contracts").AgentVersionId,
    );
    writeStoredWorkflowBuilderDraft(storedDraft);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.includes("/api/v1/auth/context")) {
          return Response.json({
            subjectId: "sub-1",
            workspaceId: "ws-1",
            role: "ADMIN",
          });
        }
        if (url.includes("/api/v1/agents") && !url.includes("/versions")) {
          return Response.json({
            agents: [
              {
                id: "agent-1",
                workspaceId: "ws-1",
                key: "demo",
                name: "Demo Agent",
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          });
        }
        if (url.includes("/api/v1/agents/agent-1/versions")) {
          return Response.json({
            versions: [
              {
                id: "av-1",
                agentId: "agent-1",
                version: 1,
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          });
        }
        return Response.json({}, { status: 404 });
      }),
    );

    renderCreatePage();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Restore saved draft" }),
      ).toBeTruthy();
    });
    await user.click(
      screen.getByRole("button", { name: "Restore saved draft" }),
    );

    await waitFor(() => {
      expect(screen.getByText(/not visible in this workspace/i)).toBeTruthy();
    });
    expect(screen.getByText("av-missing")).toBeTruthy();
    const versionSelect = screen.getByLabelText(
      "Agent version (immutable)",
    ) as HTMLSelectElement;
    expect(versionSelect.value).toBe("av-missing");
    expect(versionSelect.disabled).toBe(true);
  });
});
