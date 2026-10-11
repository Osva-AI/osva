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

function renderLaunch(canExecute = true) {
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
});
