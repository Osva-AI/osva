import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { stubHumanSessionFetch } from "./human-auth-fetch-stub.js";

import { WorkflowCreatePage } from "../src/client/routes/workflow-create-page";
import {
  addAgentNode,
  createEmptyWorkflowBuilderDraft,
  setAgentNodeVersion,
  updateRegistry,
} from "../src/client/lib/workflow-builder-linear";
import { writeStoredWorkflowBuilderDraft } from "../src/client/lib/workflow-builder-storage";

vi.mock("../src/client/components/workflow/workflow-builder-canvas", () => ({
  WorkflowBuilderCanvas: () => (
    <div data-testid="workflow-builder-canvas-mock" />
  ),
}));

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

async function fillWorkflowRegistry(
  user: ReturnType<typeof userEvent.setup>,
  key: string,
  name: string,
) {
  await user.click(screen.getByRole("button", { name: "Edit details" }));
  await user.clear(screen.getByLabelText("Registry key"));
  await user.type(screen.getByLabelText("Registry key"), key);
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), name);
  await user.click(screen.getByRole("button", { name: "Done" }));
}

async function addAgentStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^AI agent\b/ }));
}

async function openAccessibleStepsList(
  user: ReturnType<typeof userEvent.setup>,
) {
  await user.click(screen.getByText("Accessible steps list"));
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

    stubHumanSessionFetch("ADMIN", "ws-1", (url, init) => {
      const method = init?.method ?? "GET";
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
      return undefined;
    });

    renderCreatePage();
    await waitFor(() => {
      expect(screen.getByTestId("workflow-studio-v2")).toBeTruthy();
    });

    await fillWorkflowRegistry(user, "demo-wf", "Demo WF");
    await addAgentStep(user);
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
        name: "Review and publish",
      }),
    );
    expect(screen.getByTestId("workflow-publish-review")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Confirm publish" }));

    await waitFor(() => {
      expect(screen.getByText("Published version")).toBeTruthy();
    });
    expect(createCalls).toBe(1);
    expect(versionCalls).toBe(1);
  }, 15_000);

  it("retries version publish without recreating workflow", async () => {
    const user = userEvent.setup();
    let createCalls = 0;
    let versionCalls = 0;

    stubHumanSessionFetch("ADMIN", "ws-1", (url, init) => {
      const method = init?.method ?? "GET";
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
      return undefined;
    });

    renderCreatePage();
    await waitFor(() => {
      expect(screen.getByTestId("workflow-studio-v2")).toBeTruthy();
    });

    await fillWorkflowRegistry(user, "partial", "Partial");
    await addAgentStep(user);
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
        name: "Review and publish",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Confirm publish" }));

    await waitFor(() => {
      expect(screen.getByText(/Request ID: req-fail-1/)).toBeTruthy();
    });
    expect(createCalls).toBe(1);
    expect(versionCalls).toBe(1);
    expect(screen.getByTestId("workflow-publish-upstream-error")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Retry publishing" }));
    await waitFor(() => {
      expect(screen.getByText("Published version")).toBeTruthy();
    });
    expect(createCalls).toBe(1);
    expect(versionCalls).toBe(2);
  }, 15_000);

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

    stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
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
      return undefined;
    });

    renderCreatePage();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Restore saved draft" }),
      ).toBeTruthy();
    });
    await user.click(
      screen.getByRole("button", { name: "Restore saved draft" }),
    );

    await openAccessibleStepsList(user);
    await user.click(
      screen.getByRole("button", { name: /Demo Agent \(v1\)/i }),
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

    stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
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
      return undefined;
    });

    renderCreatePage();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Restore saved draft" }),
      ).toBeTruthy();
    });
    await user.click(
      screen.getByRole("button", { name: "Restore saved draft" }),
    );

    await openAccessibleStepsList(user);
    await user.click(
      screen.getAllByRole("button", { name: /Agent version unavailable/i })[0]!,
    );

    await waitFor(() => {
      expect(
        screen.getAllByText(/not visible in this workspace/i).length,
      ).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/av-missing/).length).toBeGreaterThan(0);
    const versionSelect = screen.getAllByLabelText(
      "Agent version (immutable)",
    )[0] as HTMLSelectElement;
    expect(versionSelect.value).toBe("av-missing");
    expect(versionSelect.disabled).toBe(true);
  });

  it("selects a node from the validation panel and keeps review blocked until valid", async () => {
    const user = userEvent.setup();
    stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
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
      return undefined;
    });

    renderCreatePage();
    await waitFor(() => {
      expect(screen.getByTestId("workflow-studio-v2")).toBeTruthy();
    });
    await fillWorkflowRegistry(user, "demo-wf", "Demo WF");
    await addAgentStep(user);

    await waitFor(() => {
      expect(screen.getByTestId("workflow-validation-panel")).toBeTruthy();
    });
    expect(
      screen.getByTestId("workflow-validation-summary").textContent,
    ).toMatch(/issue/);

    await user.click(screen.getByRole("button", { name: "View issues" }));
    await user.click(
      screen.getByTestId("workflow-validation-fix-agent-step-1"),
    );
    expect(
      screen.getAllByTestId("workflow-inspector-errors").length,
    ).toBeGreaterThan(0);

    await user.click(
      screen.getByRole("button", { name: "Review and publish" }),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Confirm publish",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Back to editor" }));
    await user.selectOptions(screen.getByLabelText("Agent"), "agent-1");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent version (immutable)")).toBeTruthy();
    });
    await user.selectOptions(
      screen.getByLabelText("Agent version (immutable)"),
      "av-1",
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("workflow-validation-summary").textContent,
      ).toMatch(/No blocking issues/);
    });
  }, 15_000);

  it("collapses palette and inspector in focus mode", async () => {
    const user = userEvent.setup();
    stubHumanSessionFetch("ADMIN", "ws-1");
    renderCreatePage();
    await waitFor(() => {
      expect(screen.getByTestId("workflow-studio-v2")).toBeTruthy();
    });
    await user.click(screen.getByRole("button", { name: "Focus mode" }));
    expect(
      document.querySelector(".workflow-studio-editor--focus"),
    ).toBeTruthy();
    expect(
      document.querySelector(".workflow-studio-editor-palette"),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show steps" }));
    expect(
      document.querySelector(".workflow-studio-editor-palette"),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Exit focus" }));
    expect(document.querySelector(".workflow-studio-editor--focus")).toBeNull();
  });

  it("confirms before replacing a draft with a template", async () => {
    const user = userEvent.setup();
    stubHumanSessionFetch("ADMIN", "ws-1");
    renderCreatePage();
    await waitFor(() => {
      expect(screen.getByTestId("workflow-studio-v2")).toBeTruthy();
    });
    await fillWorkflowRegistry(user, "demo-wf", "Demo WF");
    await user.click(screen.getByRole("button", { name: "Templates" }));
    await user.click(
      screen.getAllByRole("button", { name: "Apply template" })[0]!,
    );
    expect(screen.getByText("Replace current draft?")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Replace draft" }));
    await waitFor(() => {
      expect(screen.getByText("Accessible steps list")).toBeTruthy();
    });
    await user.click(screen.getByText("Accessible steps list"));
    expect(
      screen.getAllByRole("button", { name: /Run AI agent/i }).length,
    ).toBeGreaterThan(0);
  });

  it("connects steps from the keyboard graph panel", async () => {
    const user = userEvent.setup();
    stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
      if (url.includes("/api/v1/agents")) {
        return Response.json({ agents: [] });
      }
      return undefined;
    });
    renderCreatePage();
    await waitFor(() => {
      expect(screen.getByTestId("workflow-studio-v2")).toBeTruthy();
    });
    await addAgentStep(user);
    await addAgentStep(user);
    await user.click(screen.getByText("Accessible steps list"));
    await user.selectOptions(
      screen.getByLabelText("Source step"),
      "agent-step-1",
    );
    await user.selectOptions(
      screen.getByLabelText("Destination step"),
      "agent-step-2",
    );
    await user.click(screen.getByRole("button", { name: "Connect steps" }));
    expect(
      screen.getByText(/Connected agent-step-1 → agent-step-2/),
    ).toBeTruthy();
  });

  it("blocks publish controls for VIEWER role", async () => {
    stubHumanSessionFetch("VIEWER", "ws-1");
    renderCreatePage();
    await waitFor(() => {
      expect(screen.getByTestId("workflow-studio-v2")).toBeTruthy();
    });
    expect(screen.getByText(/cannot publish workflows/i)).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Review and publish",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
