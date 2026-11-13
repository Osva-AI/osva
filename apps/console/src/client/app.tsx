import { QueryClientProvider } from "@tanstack/react-query";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useParams,
} from "react-router-dom";

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
import { WorkflowNlBuilderPage } from "./routes/workflow-nl-builder-page";
import { WorkflowVersionCreatePage } from "./routes/workflow-version-create-page";
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
import { ExampleDetailPage } from "./routes/example-detail-page";
import { ExamplesPage } from "./routes/examples-page";
import { ActivityPage } from "./routes/activity-page";
import { OverviewPage } from "./routes/overview-page";
import { SettingsPage } from "./routes/settings-page";
import { ApiKeysPage } from "./routes/api-keys-page";
import { KnowledgePage } from "./routes/knowledge-page";
import { KnowledgeSourcePage } from "./routes/knowledge-source-page";
import { MemoryPage } from "./routes/memory-page";
import { MemoryNamespacePage } from "./routes/memory-namespace-page";
import { AgentPlaygroundPage } from "./routes/agent-playground-page";
import { TestingStudioPage } from "./routes/testing-studio-page";
import { EvaluationSuiteCreatePage } from "./routes/evaluation-suite-create-page";
import { EvaluationSuiteDetailPage } from "./routes/evaluation-suite-detail-page";
import { EvaluationSuiteVersionCreatePage } from "./routes/evaluation-suite-version-create-page";
import { EvaluationSuiteVersionPage } from "./routes/evaluation-suite-version-page";
import { EvaluationRunLaunchPage } from "./routes/evaluation-run-launch-page";
import { EvaluationRunDetailPage } from "./routes/evaluation-run-detail-page";
import { OfficeMissionControlPage } from "./routes/office-mission-control-page";
import { OfficeTeamDetailPage } from "./routes/office-team-detail-page";
import { OfficeTeamsPage } from "./routes/office-teams-page";
import { OfficeWorkerDetailPage } from "./routes/office-worker-detail-page";
import { OfficeWorkersPage } from "./routes/office-workers-page";
import { OfficeChatPage } from "./routes/office-chat-page";
import { OfficeInboxPage } from "./routes/office-inbox-page";
import { OfficeMissionsPage } from "./routes/office-missions-page";
import { OfficeMissionDetailPage } from "./routes/office-mission-detail-page";
import { OfficeTaskCreatePage } from "./routes/office-task-create-page";
import { OfficeActivityPage } from "./routes/office-activity-page";
import { OfficeTaskDetailPage } from "./routes/office-task-detail-page";
import { OfficeTasksBoardPage } from "./routes/office-tasks-board-page";
import { OfficeDeliverablesPage } from "./routes/office-deliverables-page";

const queryClient = createQueryClient();

function LegacyModelProfilesRedirect() {
  const { modelProfileId } = useParams<{ modelProfileId: string }>();
  if (modelProfileId === undefined) {
    return <Navigate to="/models" replace />;
  }
  return <Navigate to={`/models/${modelProfileId}`} replace />;
}

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
                  <Route path="/activity" element={<ActivityPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/settings/api-keys" element={<ApiKeysPage />} />
                  <Route path="/examples" element={<ExamplesPage />} />
                  <Route
                    path="/examples/:exampleId"
                    element={<ExampleDetailPage />}
                  />
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
                    path="/models/profiles/:modelProfileId"
                    element={<LegacyModelProfilesRedirect />}
                  />
                  <Route
                    path="/models/profiles"
                    element={<Navigate to="/models" replace />}
                  />
                  <Route
                    path="/models/:modelProfileId"
                    element={<ModelProfileDetailPage />}
                  />
                  <Route path="/knowledge" element={<KnowledgePage />} />
                  <Route
                    path="/knowledge/sources/:sourceId"
                    element={<KnowledgeSourcePage />}
                  />
                  <Route path="/memory" element={<MemoryPage />} />
                  <Route
                    path="/memory/namespaces/:namespaceId"
                    element={<MemoryNamespacePage />}
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
                  <Route path="/testing" element={<TestingStudioPage />} />
                  <Route
                    path="/testing/suites/new"
                    element={<EvaluationSuiteCreatePage />}
                  />
                  <Route
                    path="/testing/suites/:evaluationSuiteId"
                    element={<EvaluationSuiteDetailPage />}
                  />
                  <Route
                    path="/testing/suites/:evaluationSuiteId/versions/new"
                    element={<EvaluationSuiteVersionCreatePage />}
                  />
                  <Route
                    path="/testing/suites/:evaluationSuiteId/versions/:evaluationSuiteVersionId"
                    element={<EvaluationSuiteVersionPage />}
                  />
                  <Route
                    path="/testing/playground"
                    element={<AgentPlaygroundPage />}
                  />
                  <Route
                    path="/testing/runs/new"
                    element={<EvaluationRunLaunchPage />}
                  />
                  <Route
                    path="/testing/runs/:evaluationRunId"
                    element={<EvaluationRunDetailPage />}
                  />
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
                    path="/workflows/new/describe"
                    element={<WorkflowNlBuilderPage />}
                  />
                  <Route
                    path="/workflows/:workflowId"
                    element={<WorkflowDetailPage />}
                  />
                  <Route
                    path="/workflows/:workflowId/versions/new"
                    element={<WorkflowVersionCreatePage />}
                  />
                  <Route
                    path="/workflows/:workflowId/versions/:workflowVersionId"
                    element={<WorkflowVersionPage />}
                  />
                  <Route
                    path="/office"
                    element={<OfficeMissionControlPage />}
                  />
                  <Route
                    path="/office/missions"
                    element={<OfficeMissionsPage />}
                  />
                  <Route
                    path="/office/missions/:missionId"
                    element={<OfficeMissionDetailPage />}
                  />
                  <Route
                    path="/office/tasks/new"
                    element={<OfficeTaskCreatePage />}
                  />
                  <Route
                    path="/office/tasks/:taskId"
                    element={<OfficeTaskDetailPage />}
                  />
                  <Route
                    path="/office/tasks"
                    element={<OfficeTasksBoardPage />}
                  />
                  <Route
                    path="/office/deliverables"
                    element={<OfficeDeliverablesPage />}
                  />
                  <Route
                    path="/office/activity"
                    element={<OfficeActivityPage />}
                  />
                  <Route path="/office/chat" element={<OfficeChatPage />} />
                  <Route
                    path="/office/chat/:threadId"
                    element={<OfficeChatPage />}
                  />
                  <Route path="/office/inbox" element={<OfficeInboxPage />} />
                  <Route path="/office/teams" element={<OfficeTeamsPage />} />
                  <Route
                    path="/office/teams/:teamId"
                    element={<OfficeTeamDetailPage />}
                  />
                  <Route
                    path="/office/workers"
                    element={<OfficeWorkersPage />}
                  />
                  <Route
                    path="/office/workers/:workerId"
                    element={<OfficeWorkerDetailPage />}
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
