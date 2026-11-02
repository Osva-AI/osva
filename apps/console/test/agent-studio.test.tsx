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

import { AuthProvider } from "../src/client/context/auth-context";
import { AgentCreatePage } from "../src/client/routes/agent-create-page";
import { AgentVersionCreatePage } from "../src/client/routes/agent-version-create-page";
import { stubHumanSessionFetch, json } from "./human-auth-fetch-stub";

vi.mock(
  "../src/client/components/agent/model-profile-version-selector",
  () => ({
    ModelProfileVersionSelector: (props: {
      readonly onChange: (
        selection: { modelProfileVersionId: string } | undefined,
      ) => void;
    }) => (
      <button
        type="button"
        onClick={() => props.onChange({ modelProfileVersionId: "mpv-1" })}
      >
        Select test model
      </button>
    ),
  }),
);

vi.mock("../src/client/components/agent/tool-version-binding-selector", () => ({
  ToolVersionBindingSelector: () => <div data-testid="tool-selector-mock" />,
}));

function renderStudio(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/agents/new" element={<AgentCreatePage />} />
            <Route
              path="/agents/:agentId/versions/new"
              element={<AgentVersionCreatePage />}
            />
            <Route
              path="/agents/:agentId/versions/:agentVersionId"
              element={<div>Published version</div>}
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const agent = {
  id: "agent-studio",
  workspaceId: "ws-1",
  key: "studio-agent",
  name: "Studio Agent",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("Agent Studio UI", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("blocks publish for empty instructions and missing model", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1");
    renderStudio("/agents/new");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent name")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Agent name"), {
      target: { value: "Support Bot" },
    });
    fireEvent.change(document.getElementById("studio-instructions")!, {
      target: { value: "" },
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Publish agent version",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText(/instructions are required/i)).toBeTruthy();
    expect(
      screen.getAllByText(/modelBinding 'primary' is not declared/i).length,
    ).toBeGreaterThan(0);
  });

  it("publishes a declarative agent and version", async () => {
    const user = userEvent.setup();
    stubHumanSessionFetch("ADMIN", "ws-1", (url, init) => {
      if (url === "/api/v1/agents" && init?.method === "POST") {
        return json({ ...agent, id: "agent-created" }, 201);
      }
      if (
        url === "/api/v1/agents/agent-created/versions" &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body)) as {
          manifest: { runtime: { type: string } };
        };
        expect(body.manifest.runtime.type).toBe("DECLARATIVE");
        return json(
          {
            id: "av-created",
            agentId: "agent-created",
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          201,
        );
      }
      if (url === "/api/v1/agents/agent-created") {
        return json({ ...agent, id: "agent-created" });
      }
      return undefined;
    });
    renderStudio("/agents/new");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent name")).toBeTruthy();
    });
    await user.type(screen.getByLabelText("Agent name"), "Support Bot");
    fireEvent.change(document.getElementById("studio-instructions")!, {
      target: { value: "Help customers with billing questions." },
    });
    await user.click(screen.getByRole("button", { name: "Select test model" }));
    await user.click(
      screen.getByRole("button", { name: "Publish agent version" }),
    );
    await waitFor(() => {
      expect(screen.getByText("Published version")).toBeTruthy();
    });
  });

  it("denies studio publish for VIEWER", async () => {
    stubHumanSessionFetch("VIEWER", "ws-1");
    renderStudio("/agents/new");
    await waitFor(() => {
      expect(
        screen.getByText(/DEVELOPER, EDITOR, ADMIN, or OWNER/i),
      ).toBeTruthy();
    });
    expect(
      (
        screen.getByRole("button", {
          name: "Publish agent version",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("switches guided and advanced modes without losing manifest fields", async () => {
    const user = userEvent.setup();
    stubHumanSessionFetch("ADMIN", "ws-1");
    renderStudio("/agents/new");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent name")).toBeTruthy();
    });
    fireEvent.change(document.getElementById("studio-instructions")!, {
      target: { value: "Round-trip instructions." },
    });
    await user.click(screen.getByRole("button", { name: "Advanced JSON" }));
    const jsonField = screen.getByLabelText(
      "AgentVersion manifest",
    ) as HTMLTextAreaElement;
    expect(jsonField.value).toMatch(/Round-trip instructions/);
    await user.click(screen.getByRole("button", { name: "Guided" }));
    expect(screen.getByDisplayValue("Round-trip instructions.")).toBeTruthy();
  });

  it("shows unavailable source version instead of defaulting the draft", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
      if (url === "/api/v1/agents/agent-studio") {
        return json(agent);
      }
      if (url === "/api/v1/agents/agent-studio/versions/missing-version") {
        return json({ message: "Not found" }, 404);
      }
      return undefined;
    });
    renderStudio("/agents/agent-studio/versions/new?from=missing-version");
    await waitFor(() => {
      expect(screen.getByText(/Source AgentVersion unavailable/i)).toBeTruthy();
    });
    expect(screen.queryByLabelText(/^Instructions$/i)).toBeNull();
  });

  it("retries AgentVersion publish without creating a duplicate Agent", async () => {
    const user = userEvent.setup();
    let agentPostCount = 0;
    let versionPostCount = 0;
    stubHumanSessionFetch("ADMIN", "ws-1", (url, init) => {
      if (url === "/api/v1/agents" && init?.method === "POST") {
        agentPostCount += 1;
        return json({ ...agent, id: "agent-partial" }, 201);
      }
      if (
        url === "/api/v1/agents/agent-partial/versions" &&
        init?.method === "POST"
      ) {
        versionPostCount += 1;
        if (versionPostCount === 1) {
          return json({ error: "version rejected" }, 500);
        }
        return json(
          {
            id: "av-retry",
            agentId: "agent-partial",
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
          201,
        );
      }
      return undefined;
    });
    renderStudio("/agents/new");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent name")).toBeTruthy();
    });
    await user.type(screen.getByLabelText("Agent name"), "Partial Bot");
    fireEvent.change(document.getElementById("studio-instructions")!, {
      target: { value: "Recover from partial publish." },
    });
    await user.click(screen.getByRole("button", { name: "Select test model" }));
    await user.click(
      screen.getByRole("button", { name: "Publish agent version" }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(/publishing the first AgentVersion failed/i),
      ).toBeTruthy();
    });
    expect(agentPostCount).toBe(1);
    expect(screen.getByText("agent-partial")).toBeTruthy();
    expect(screen.queryByText("Published version")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Publish agent version" }),
    );
    await waitFor(() => {
      expect(screen.getByText("Published version")).toBeTruthy();
    });
    expect(agentPostCount).toBe(1);
    expect(versionPostCount).toBe(2);
  });

  it("preserves invalid JSON when switching back to guided", async () => {
    const user = userEvent.setup();
    stubHumanSessionFetch("ADMIN", "ws-1");
    renderStudio("/agents/new");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent name")).toBeTruthy();
    });
    await user.click(screen.getByRole("button", { name: "Advanced JSON" }));
    const jsonField = screen.getByLabelText(
      "AgentVersion manifest",
    ) as HTMLTextAreaElement;
    fireEvent.change(jsonField, { target: { value: "{ broken-json" } });
    await user.click(screen.getByRole("button", { name: "Guided" }));
    expect(screen.getByText(/Manifest JSON is invalid/i)).toBeTruthy();
    const modeToggle = document.querySelector(".agent-studio-mode-toggle");
    const advancedToggle = modeToggle?.querySelectorAll("button")[1];
    expect(advancedToggle?.textContent).toContain("Advanced JSON");
    await user.click(advancedToggle!);
    expect(
      (screen.getByLabelText("AgentVersion manifest") as HTMLTextAreaElement)
        .value,
    ).toBe("{ broken-json");
  });

  it("loads a copied version draft for a new immutable version", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1", (url) => {
      if (url === "/api/v1/agents/agent-studio") {
        return json(agent);
      }
      if (url === "/api/v1/agents/agent-studio/versions/av-source") {
        return json({
          id: "av-source",
          agentId: "agent-studio",
          version: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          manifest: {
            schemaVersion: "1",
            key: "studio-agent",
            name: "Studio Agent",
            runtime: {
              type: "DECLARATIVE",
              config: {
                configVersion: "1",
                instructions: "Existing instructions",
                modelBinding: "primary",
                allowedToolBindings: [],
                maxModelInvocations: 4,
                maxToolInvocations: 0,
              },
            },
            input: { schema: { type: "object" } },
            output: { schema: { type: "object" } },
            execution: { timeoutMs: 30_000, maxAttempts: 1 },
            capabilities: { model: true, tools: [] },
            models: { primary: { modelProfileVersionId: "mpv-1" } },
          },
        });
      }
      return undefined;
    });
    renderStudio("/agents/agent-studio/versions/new?from=av-source");
    await waitFor(() => {
      expect(screen.getByDisplayValue("Existing instructions")).toBeTruthy();
    });
    expect(screen.getByText(/Copied configuration from version/i)).toBeTruthy();
  });
});
