import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/app-shell/app-shell";
import { createQueryClient } from "./lib/query-client";
import { AgentCreatePage } from "./routes/agent-create-page";
import { AgentDetailPage } from "./routes/agent-detail-page";
import { AgentVersionCreatePage } from "./routes/agent-version-create-page";
import { AgentVersionPage } from "./routes/agent-version-page";
import { AgentsPage } from "./routes/agents-page";
import { OnboardingPage } from "./routes/onboarding-page";
import { RunDetailPage } from "./routes/run-detail-page";
import { RunsPage } from "./routes/runs-page";
import { WorkflowDetailPage } from "./routes/workflow-detail-page";
import { WorkflowRunDetailPage } from "./routes/workflow-run-detail-page";
import { WorkflowRunsPage } from "./routes/workflow-runs-page";
import { WorkflowVersionPage } from "./routes/workflow-version-page";
import { WorkflowCreatePage } from "./routes/workflow-create-page";
import { WorkflowsPage } from "./routes/workflows-page";

const queryClient = createQueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/runs" replace />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/agents/new" element={<AgentCreatePage />} />
            <Route path="/agents/:agentId" element={<AgentDetailPage />} />
            <Route
              path="/agents/:agentId/versions/new"
              element={<AgentVersionCreatePage />}
            />
            <Route
              path="/agents/:agentId/versions/:agentVersionId"
              element={<AgentVersionPage />}
            />
            <Route path="/runs" element={<RunsPage />} />
            <Route path="/runs/:runId" element={<RunDetailPage />} />
            <Route
              path="/runs/:runId/attempts/:runAttemptId"
              element={<RunDetailPage />}
            />
            <Route path="/workflows" element={<WorkflowsPage />} />
            <Route path="/workflows/new" element={<WorkflowCreatePage />} />
            <Route
              path="/workflows/:workflowId"
              element={<WorkflowDetailPage />}
            />
            <Route
              path="/workflows/:workflowId/versions/:workflowVersionId"
              element={<WorkflowVersionPage />}
            />
            <Route path="/workflow-runs" element={<WorkflowRunsPage />} />
            <Route
              path="/workflow-runs/:workflowRunId"
              element={<WorkflowRunDetailPage />}
            />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
