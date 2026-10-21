import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkflowRunLaunchForm } from "../src/client/components/workflow/workflow-run-launch-form";
import type { WorkflowDefinitionView } from "../src/client/lib/workflow-definition";

const researchSchema = {
  type: "object",
  required: ["schemaVersion", "request"],
  properties: {
    schemaVersion: { type: "string", const: "1" },
    request: {
      type: "object",
      required: ["requestId", "packageName", "useCase", "constraints"],
      properties: {
        requestId: { type: "string" },
        packageName: { type: "string" },
        useCase: { type: "string" },
        constraints: { type: "array", items: { type: "string" } },
      },
    },
  },
};

const researchAnalysisDefinition: WorkflowDefinitionView = {
  schemaVersion: "3",
  nodes: [
    { key: "research", type: "AGENT", agentVersionId: "av-research" },
    { key: "analysis", type: "AGENT", agentVersionId: "av-analysis" },
  ],
  edges: [{ from: "research", to: "analysis" }],
};

const canonicalInput = {
  schemaVersion: "1",
  request: {
    requestId: "m8-4-browser-001",
    packageName: "zod",
    useCase: "Runtime validation for public API request bodies",
    constraints: ["Permissive license", "Actively maintained"],
  },
};

function renderLaunch(canExecute = true, definition?: WorkflowDefinitionView) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/workflows/wf-1/versions/wv-1"]}>
        <Routes>
          <Route
            path="/workflows/:workflowId/versions/:workflowVersionId"
            element={
              <WorkflowRunLaunchForm
                workflowId="wf-1"
                workflowKey="demo"
                workflowName="Demo"
                workflowVersionId="wv-1"
                versionNumber={1}
                canExecute={canExecute}
                definition={definition}
              />
            }
          />
          <Route
            path="/workflow-runs/:workflowRunId"
            element={<div>Opened WorkflowRun</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubAgentCatalog(
  fetchMock: ReturnType<typeof vi.fn>,
  schema: unknown,
) {
  fetchMock.mockImplementation(
    async (input: RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/v1/agents") {
        return Response.json({
          agents: [
            {
              id: "agent-research",
              workspaceId: "ws-1",
              key: "canonical-dependency-research",
              name: "Research",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url === "/api/v1/agents/agent-research/versions") {
        return Response.json({
          versions: [
            {
              id: "av-research",
              agentId: "agent-research",
              version: 1,
              createdAt: "2026-01-01T00:00:00.000Z",
              manifest: { input: { schema } },
            },
          ],
        });
      }
      if (url === "/api/v1/workflow-runs" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          workflowVersionId: string;
          input: unknown;
        };
        return Response.json({
          id: "wr-created",
          workspaceId: "ws-1",
          workflowId: "wf-1",
          workflowVersionId: body.workflowVersionId,
          status: "PENDING",
          input: body.input,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          nodeRuns: [],
          approvalRequests: [],
        });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  );
}

describe("WorkflowRunLaunchForm", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("rejects malformed JSON before calling the BFF", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderLaunch();

    const textarea = screen.getByLabelText("Run input (JSON)");
    fireEvent.change(textarea, { target: { value: "{not-json" } });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent ?? "").toMatch(
      /JSON|position|Unexpected/i,
    );
    expect(
      (screen.getByRole("button", { name: "Start run" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binds the published version id and navigates to the created WorkflowRun", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      expect(String(input)).toBe("/api/v1/workflow-runs");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        workflowVersionId: "wv-1",
        input: { invoiceId: "inv-1" },
      });
      return Response.json({
        id: "wr-created",
        workspaceId: "ws-1",
        workflowId: "wf-1",
        workflowVersionId: "wv-1",
        status: "PENDING",
        input: { invoiceId: "inv-1" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        nodeRuns: [],
        approvalRequests: [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    renderLaunch();
    const textarea = screen.getByLabelText("Run input (JSON)");
    fireEvent.change(textarea, {
      target: { value: '{"invoiceId":"inv-1"}' },
    });
    await user.click(screen.getByRole("button", { name: "Start run" }));
    await user.click(screen.getByRole("button", { name: "Confirm start run" }));

    await waitFor(() => {
      expect(screen.getByText("Opened WorkflowRun")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces authorization failures without inventing a run", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "permission denied", requestId: "req-forbidden" },
          {
            status: 403,
            headers: { "x-osva-request-id": "req-forbidden" },
          },
        ),
      ),
    );

    renderLaunch();
    await user.click(screen.getByRole("button", { name: "Start run" }));
    await user.click(screen.getByRole("button", { name: "Confirm start run" }));

    await waitFor(() => {
      expect(screen.getByText("req-forbidden")).toBeTruthy();
    });
    expect(screen.getByText("permission denied")).toBeTruthy();
    expect(screen.queryByText("Opened WorkflowRun")).toBeNull();
  });

  it("does not let viewers start a run", () => {
    renderLaunch(false);
    expect(
      (screen.getByRole("button", { name: "Start run" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(/OPERATOR, EDITOR, or ADMIN/)).toBeTruthy();
  });

  it("shows the root AGENT input contract and does not treat {} as executable", async () => {
    const fetchMock = vi.fn();
    stubAgentCatalog(fetchMock, researchSchema);
    vi.stubGlobal("fetch", fetchMock);
    renderLaunch(true, researchAnalysisDefinition);

    await waitFor(() => {
      expect(screen.getByText("Input schema")).toBeTruthy();
    });
    expect(screen.getByText("research")).toBeTruthy();
    expect(
      screen.getByText(/does not mean the first agent will accept/i),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Run input (JSON)") as HTMLTextAreaElement).value,
    ).toBe("{}");
  });

  it("posts structured canonical input without changing the published version id", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    stubAgentCatalog(fetchMock, researchSchema);
    vi.stubGlobal("fetch", fetchMock);
    renderLaunch(true, researchAnalysisDefinition);

    await waitFor(() => {
      expect(screen.getByText("Input schema")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Run input (JSON)"), {
      target: { value: JSON.stringify(canonicalInput) },
    });
    await user.click(screen.getByRole("button", { name: "Start run" }));
    await user.click(screen.getByRole("button", { name: "Confirm start run" }));

    await waitFor(() => {
      expect(screen.getByText("Opened WorkflowRun")).toBeTruthy();
    });
    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === "/api/v1/workflow-runs" && init?.method === "POST",
    );
    expect(createCall).toBeDefined();
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      workflowVersionId: "wv-1",
      input: canonicalInput,
    });
  });

  it("keeps the contract visible for viewers without enabling start", async () => {
    const fetchMock = vi.fn();
    stubAgentCatalog(fetchMock, researchSchema);
    vi.stubGlobal("fetch", fetchMock);
    renderLaunch(false, researchAnalysisDefinition);

    await waitFor(() => {
      expect(screen.getByText("Input schema")).toBeTruthy();
    });
    expect(
      (screen.getByRole("button", { name: "Start run" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("Run input (JSON)") as HTMLTextAreaElement)
        .disabled,
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url) === "/api/v1/workflow-runs" && init?.method === "POST",
      ),
    ).toBe(false);
  });
});
