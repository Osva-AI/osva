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

import { readAgentStudioCreateDraft } from "../src/client/lib/agent-studio-create-draft-storage";
import { AGENT_STUDIO_TEMPLATE_IDEAS } from "../src/client/lib/agent-studio-v2-templates";
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

async function goToEquipStage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: "Continue to capabilities" }),
  );
}

async function goToReviewStage(user: ReturnType<typeof userEvent.setup>) {
  await goToEquipStage(user);
  await user.click(screen.getByRole("button", { name: "Select test model" }));
  await user.click(screen.getByRole("button", { name: "Continue to review" }));
}

async function confirmPublish(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
) {
  await user.click(screen.getByRole("button", { name: label }));
  await waitFor(() => {
    expect(document.querySelector(".dialog-panel")).toBeTruthy();
  });
  const confirm = document.querySelector(
    '[data-confirm-dialog="confirm"]',
  ) as HTMLButtonElement;
  await user.click(confirm);
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
    const user = userEvent.setup();
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
    await user.click(
      screen.getByRole("button", { name: "Continue to capabilities" }),
    );
    expect(
      screen.getByText(
        /Add instructions describing what your agent should do/i,
      ),
    ).toBeTruthy();
    fireEvent.change(document.getElementById("studio-instructions")!, {
      target: { value: "Help customers." },
    });
    await goToEquipStage(user);
    await user.click(
      screen.getByRole("button", { name: "Continue to review" }),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Publish agent version",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByText(/Choose an AI model version before publishing/i),
    ).toBeTruthy();
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
    await goToReviewStage(user);
    await confirmPublish(user, "Publish agent version");
    await waitFor(() => {
      expect(screen.getByText("Published version")).toBeTruthy();
    });
  });

  it("denies studio publish for VIEWER", async () => {
    stubHumanSessionFetch("VIEWER", "ws-1");
    renderStudio("/agents/new");
    await waitFor(() => {
      expect(screen.getByTestId("agent-studio-readonly-notice")).toBeTruthy();
    });
    expect(
      (screen.getByLabelText("Agent name") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText(/^Instructions/i) as HTMLTextAreaElement).disabled,
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Publish agent version" }),
    ).toBeNull();
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
    await user.click(
      screen.getAllByRole("button", { name: "Advanced JSON" })[0]!,
    );
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
    await goToReviewStage(user);
    await confirmPublish(user, "Publish agent version");
    await waitFor(() => {
      expect(
        screen.getByText(/Agent created, but publishing didn't finish/i),
      ).toBeTruthy();
    });
    expect(
      screen.getByRole("button", { name: "Retry publishing" }),
    ).toBeTruthy();
    expect(agentPostCount).toBe(1);
    expect(screen.getByText("agent-partial")).toBeTruthy();
    expect(screen.queryByText("Published version")).toBeNull();

    await confirmPublish(user, "Retry publishing");
    await waitFor(() => {
      expect(screen.getByText("Published version")).toBeTruthy();
    });
    expect(agentPostCount).toBe(1);
    expect(versionPostCount).toBe(2);
  });

  it("does not show required-field errors on a fresh agent before interaction", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1");
    renderStudio("/agents/new");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent name")).toBeTruthy();
    });
    expect(screen.queryByText(/Agent instructions are required/i)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows describe validation after attempting to continue with empty instructions", async () => {
    const user = userEvent.setup();
    stubHumanSessionFetch("ADMIN", "ws-1");
    renderStudio("/agents/new");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent name")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Agent name"), {
      target: { value: "Named agent" },
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to capabilities" }),
    );
    expect(
      screen.getByText(
        /Add instructions describing what your agent should do/i,
      ),
    ).toBeTruthy();
  });

  it("confirms before replacing a non-empty draft with a template", async () => {
    const user = userEvent.setup();
    stubHumanSessionFetch("ADMIN", "ws-1");
    renderStudio("/agents/new");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent name")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Agent name"), {
      target: { value: "Existing draft" },
    });
    fireEvent.change(document.getElementById("studio-instructions")!, {
      target: { value: "Keep until confirmed." },
    });
    await user.click(screen.getByRole("button", { name: "Templates" }));
    await user.click(
      screen.getAllByRole("button", { name: "Use this idea" })[0]!,
    );
    expect(screen.getByText(/Replace current draft\?/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Replace draft" }));
    expect(
      screen.getByDisplayValue(AGENT_STUDIO_TEMPLATE_IDEAS[0]!.suggestedName),
    ).toBeTruthy();
  });

  it("restores create-agent draft after leaving for Models and returning", async () => {
    stubHumanSessionFetch("ADMIN", "ws-1");
    const { unmount } = renderStudio("/agents/new");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent name")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("Agent name"), {
      target: { value: "Draft survivor" },
    });
    fireEvent.change(document.getElementById("studio-instructions")!, {
      target: { value: "Survives navigation." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to capabilities" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /What will your agent need\?/i }),
      ).toBeTruthy();
    });
    await waitFor(() => {
      expect(readAgentStudioCreateDraft("ws-1")?.agentName).toBe(
        "Draft survivor",
      );
    });
    unmount();
    renderStudio("/agents/new");
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /What will your agent need\?/i }),
      ).toBeTruthy();
    });
    expect(readAgentStudioCreateDraft("ws-1")?.agentName).toBe(
      "Draft survivor",
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "1 Describe" }));
    expect(screen.getByDisplayValue("Draft survivor")).toBeTruthy();
    expect(screen.getByDisplayValue("Survives navigation.")).toBeTruthy();
  });

  it("does not append examples to instructions when changing stages", async () => {
    const user = userEvent.setup();
    stubHumanSessionFetch("ADMIN", "ws-1");
    renderStudio("/agents/new");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent name")).toBeTruthy();
    });
    fireEvent.change(document.getElementById("studio-instructions")!, {
      target: { value: "Base only." },
    });
    fireEvent.change(document.getElementById("studio-examples")!, {
      target: { value: "User: Hi" },
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to capabilities" }),
    );
    await user.click(screen.getByRole("button", { name: "1 Describe" }));
    expect(
      (document.getElementById("studio-instructions") as HTMLTextAreaElement)
        .value,
    ).toBe("Base only.");
  });

  it("preserves invalid JSON when switching back to guided", async () => {
    const user = userEvent.setup();
    stubHumanSessionFetch("ADMIN", "ws-1");
    renderStudio("/agents/new");
    await waitFor(() => {
      expect(screen.getByLabelText("Agent name")).toBeTruthy();
    });
    await user.click(
      screen.getAllByRole("button", { name: "Advanced JSON" })[0]!,
    );
    const jsonField = screen.getByLabelText(
      "AgentVersion manifest",
    ) as HTMLTextAreaElement;
    fireEvent.change(jsonField, { target: { value: "{ broken-json" } });
    await user.click(screen.getByRole("button", { name: "Guided" }));
    expect(screen.getByText(/Manifest JSON is invalid/i)).toBeTruthy();
    await user.click(
      screen.getAllByRole("button", { name: "Advanced JSON" })[0]!,
    );
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
    expect(
      screen.getAllByText(/Copied configuration from version/i).length,
    ).toBeGreaterThan(0);
  });
});
