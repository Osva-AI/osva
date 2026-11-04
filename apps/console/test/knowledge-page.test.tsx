import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { KnowledgeSourcePage } from "../src/client/routes/knowledge-source-page";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthProvider } from "../src/client/context/auth-context";
import { KnowledgePage } from "../src/client/routes/knowledge-page";
import { json, stubHumanSessionFetch } from "./human-auth-fetch-stub";

function renderKnowledge() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/knowledge"]}>
          <Routes>
            <Route path="/knowledge" element={<KnowledgePage />} />
            <Route
              path="/knowledge/sources/:sourceId"
              element={<KnowledgeSourcePage />}
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("Knowledge UI V2.7C", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders hub with empty sources", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url, init) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        return undefined;
      }
      if (url.includes("/api/v1/knowledge-sources")) {
        return json({ items: [] });
      }
      if (url.includes("/api/v1/artifacts")) {
        return json({ items: [] });
      }
      return undefined;
    });

    renderKnowledge();

    await waitFor(() => {
      expect(screen.getByTestId("knowledge-v2-page")).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText(/No knowledge sources yet/i)).toBeTruthy();
    });
    expect(screen.getByText(/Create knowledge source/i)).toBeTruthy();
  });

  it("hides create flow for VIEWER and shows read-only banner", async () => {
    stubHumanSessionFetch("VIEWER", "ws-1", (url, init) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        return undefined;
      }
      if (url.includes("/api/v1/knowledge-sources")) {
        return json({ items: [] });
      }
      return undefined;
    });

    renderKnowledge();

    await waitFor(() => {
      expect(screen.getByText(/Read-only access/i)).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.queryByText(/Create knowledge source/i)).toBeNull();
    });
  });

  it("lists sources with readiness from catalog", async () => {
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url, init) => {
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        return undefined;
      }
      if (url.includes("/api/v1/knowledge-sources/ks-1/indexes")) {
        return json({
          items: [
            {
              id: "ki-1",
              workspaceId: "ws-1",
              knowledgeSourceId: "ks-1",
              status: "READY",
              parserKey: "osva_native_v1",
              parserVersion: "1",
              chunkerKey: "recursive_text_v1",
              chunkerVersion: "1",
              chunkSize: 512,
              chunkOverlap: 64,
              embeddingProvider: "openai",
              embeddingModel: "text-embedding-3-small",
              embeddingDimensions: 1536,
              distanceMetric: "COSINE",
              pipelineFingerprint: "fp",
              attemptCount: 1,
              chunkCount: 10,
              embeddedChunkCount: 10,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
              readyAt: "2026-01-02T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/api/v1/knowledge-sources")) {
        return json({
          items: [
            {
              id: "ks-1",
              workspaceId: "ws-1",
              key: "docs",
              name: "Product docs",
              artifactId: "art-1",
              attributes: {},
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/api/v1/artifacts")) {
        return json({ items: [] });
      }
      return undefined;
    });

    renderKnowledge();

    await waitFor(() => {
      expect(screen.getByText("Product docs")).toBeTruthy();
    });
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText(/1 of 1 READY/i)).toBeTruthy();
  });

  it("walks artifact-first create steps", async () => {
    const user = userEvent.setup();
    stubHumanSessionFetch("DEVELOPER", "ws-1", (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "POST" && url.includes("/api/v1/knowledge-sources")) {
        return json({
          id: "ks-new",
          workspaceId: "ws-1",
          key: "handbook",
          name: "Handbook",
          artifactId: "art-1",
          attributes: {},
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      if (url.includes("/api/v1/knowledge-sources/ks-new/indexes")) {
        return json({ items: [] });
      }
      if (url.includes("/api/v1/knowledge-sources/ks-new")) {
        return json({
          id: "ks-new",
          workspaceId: "ws-1",
          key: "handbook",
          name: "Handbook",
          artifactId: "art-1",
          attributes: {},
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      if (url.includes("/api/v1/knowledge-sources")) {
        return json({ items: [] });
      }
      if (url.includes("/api/v1/artifacts/art-1")) {
        return json({
          id: "art-1",
          name: "Handbook PDF",
          mediaType: "application/pdf",
        });
      }
      if (url.includes("/api/v1/artifacts")) {
        return json({
          items: [
            {
              id: "art-1",
              name: "Handbook PDF",
              mediaType: "application/pdf",
            },
          ],
        });
      }
      return undefined;
    });

    renderKnowledge();

    await waitFor(() => {
      expect(screen.getByText(/Create knowledge source/i)).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Workspace artifact")).toBeTruthy();
    });

    await user.selectOptions(
      screen.getByLabelText("Workspace artifact"),
      "art-1",
    );
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(
      screen.getByRole("textbox", { name: /Display name/i }),
      "Handbook",
    );
    await user.type(screen.getByRole("textbox", { name: /^Key/i }), "handbook");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Create source" }));

    await waitFor(() => {
      expect(screen.getByTestId("knowledge-source-detail-page")).toBeTruthy();
    });
  });
});
