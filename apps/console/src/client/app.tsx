import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { RequireAuth, RequireWorkspace } from "./components/auth/require-auth";
import { AppShell } from "./components/app-shell/app-shell";
import { AuthProvider } from "./context/auth-context";
import { createQueryClient } from "./lib/query-client";
import { AgentCreateDeveloperPage } from "./routes/agent-create-developer-page";
import { AgentCreatePage } from "./routes/agent-create-page";
import { AgentDetailPage } from "./routes/agent-detail-page";
import { AgentVersionCreatePage } from "./routes/agent-version-create-page";
import { AgentVersionPage } from "./routes/agent-version-page";
import { AgentsPage } from "./routes/agents-page";
import { LoginPage } from "./routes/login-page";
import { OnboardingPage } from "./routes/onboarding-page";
import { RecoveryPage, SetupPage } from "./routes/token-password-page";
import { RunDetailPage } from "./routes/run-detail-page";
import { RunsPage } from "./routes/runs-page";
import { SecurityActivityPage } from "./routes/security-activity-page";
import { SelectWorkspacePage } from "./routes/select-workspace-page";
import { WorkflowDetailPage } from "./routes/workflow-detail-page";
import { WorkflowRunDetailPage } from "./routes/workflow-run-detail-page";
import { WorkflowRunsPage } from "./routes/workflow-runs-page";
import { WorkflowVersionPage } from "./routes/workflow-version-page";
import { WorkflowCreatePage } from "./routes/workflow-create-page";
import { WorkflowsPage } from "./routes/workflows-page";
import { WorkspaceAccessPage } from "./routes/workspace-access-page";
import { ModelsPage } from "./routes/models-page";
import { ModelConnectionsPage } from "./routes/model-connections-page";
import { ModelConnectionDetailPage } from "./routes/model-connection-detail-page";
import { ModelProfileDetailPage } from "./routes/model-profile-detail-page";
import { ToolsPage } from "./routes/tools-page";
import { ToolDetailPage } from "./routes/tool-detail-page";
import { ConnectorsPage } from "./routes/connectors-page";
import { ConnectorDetailPage } from "./routes/connector-detail-page";
import { OverviewPage } from "./routes/overview-page";

const queryClient = createQueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/recovery" element={<RecoveryPage />} />
            <Route element={<RequireAuth />}>
              <Route
                path="/select-workspace"
                element={<SelectWorkspacePage />}
              />
              <Route element={<RequireWorkspace />}>
                <Route element={<AppShell />}>
                  <Route
                    path="/"
                    element={<Navigate to="/overview" replace />}
                  />
                  <Route path="/overview" element={<OverviewPage />} />
                  <Route path="/onboarding" element={<OnboardingPage />} />
                  <Route path="/agents" element={<AgentsPage />} />
                  <Route path="/agents/new" element={<AgentCreatePage />} />
                  <Route
                    path="/agents/new/developer"
                    element={<AgentCreateDeveloperPage />}
                  />
                  <Route
                    path="/agents/:agentId"
                    element={<AgentDetailPage />}
                  />
                  <Route
                    path="/agents/:agentId/versions/new"
                    element={<AgentVersionCreatePage />}
                  />
                  <Route
                    path="/agents/:agentId/versions/:agentVersionId"
                    element={<AgentVersionPage />}
                  />
                  <Route path="/models" element={<ModelsPage />} />
                  <Route
                    path="/models/connections"
                    element={<ModelConnectionsPage />}
                  />
                  <Route
                    path="/models/connections/:connectionId"
                    element={<ModelConnectionDetailPage />}
                  />
                  <Route
                    path="/models/:modelProfileId"
                    element={<ModelProfileDetailPage />}
                  />
                  <Route path="/tools" element={<ToolsPage />} />
                  <Route
                    path="/tools/connectors"
                    element={<ConnectorsPage />}
                  />
                  <Route
                    path="/tools/connectors/:connectorId"
                    element={<ConnectorDetailPage />}
                  />
                  <Route path="/tools/:toolId" element={<ToolDetailPage />} />
                  <Route path="/runs" element={<RunsPage />} />
                  <Route path="/runs/:runId" element={<RunDetailPage />} />
                  <Route
                    path="/runs/:runId/attempts/:runAttemptId"
                    element={<RunDetailPage />}
                  />
                  <Route path="/workflows" element={<WorkflowsPage />} />
                  <Route
                    path="/workflows/new"
                    element={<WorkflowCreatePage />}
                  />
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
                  <Route
                    path="/workspace/access"
                    element={<WorkspaceAccessPage />}
                  />
                  <Route
                    path="/workspace/security"
                    element={<SecurityActivityPage />}
                  />
                </Route>
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
