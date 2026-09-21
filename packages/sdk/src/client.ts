import { OsvaHttpClient, type OsvaHttpClientOptions } from "./http-client.js";
import { AgentsResource } from "./resources/agents.js";
import { ApiKeysResource } from "./resources/api-keys.js";
import { ApprovalsResource } from "./resources/approvals.js";
import {
  EvaluationRunsResource,
  EvaluationSuitesResource,
} from "./resources/evaluation.js";
import { MemoryNamespacesResource } from "./resources/memory-namespaces.js";
import { ArtifactsResource } from "./resources/artifacts.js";
import { KnowledgeResource } from "./resources/knowledge.js";
import { KnowledgeIndexesResource } from "./resources/knowledge-indexes.js";
import { KnowledgeSourcesResource } from "./resources/knowledge-sources.js";
import { RunsResource } from "./resources/runs.js";
import { SchedulesResource } from "./resources/schedules.js";
import { WorkflowRunsResource } from "./resources/workflow-runs.js";
import { WorkflowsResource } from "./resources/workflows.js";
import { OfficeWorkersResource } from "./resources/office-workers.js";
import { RolesResource } from "./resources/office-roles.js";
import { TeamsResource } from "./resources/office-teams.js";
import { GoalsResource } from "./resources/goals.js";
import { AssignmentsResource } from "./resources/assignments.js";

export type OsvaClientOptions = OsvaHttpClientOptions;

export class OsvaClient {
  readonly agents: AgentsResource;
  readonly apiKeys: ApiKeysResource;
  readonly runs: RunsResource;
  readonly workflows: WorkflowsResource;
  readonly workflowRuns: WorkflowRunsResource;
  readonly approvals: ApprovalsResource;
  readonly schedules: SchedulesResource;
  readonly memoryNamespaces: MemoryNamespacesResource;
  readonly artifacts: ArtifactsResource;
  readonly knowledgeSources: KnowledgeSourcesResource;
  readonly knowledgeIndexes: KnowledgeIndexesResource;
  readonly knowledge: KnowledgeResource;
  readonly evaluationSuites: EvaluationSuitesResource;
  readonly evaluationRuns: EvaluationRunsResource;
  readonly officeWorkers: OfficeWorkersResource;
  readonly roles: RolesResource;
  readonly teams: TeamsResource;
  readonly goals: GoalsResource;
  readonly assignments: AssignmentsResource;

  private readonly http: OsvaHttpClient;

  constructor(options: OsvaClientOptions) {
    this.http = new OsvaHttpClient(options);
    this.agents = new AgentsResource(this.http);
    this.apiKeys = new ApiKeysResource(this.http);
    this.runs = new RunsResource(this.http);
    this.workflows = new WorkflowsResource(this.http);
    this.workflowRuns = new WorkflowRunsResource(this.http);
    this.approvals = new ApprovalsResource(this.http);
    this.schedules = new SchedulesResource(this.http);
    this.memoryNamespaces = new MemoryNamespacesResource(this.http);
    this.artifacts = new ArtifactsResource(this.http);
    this.knowledgeSources = new KnowledgeSourcesResource(this.http);
    this.knowledgeIndexes = new KnowledgeIndexesResource(this.http);
    this.knowledge = new KnowledgeResource(this.http);
    this.evaluationSuites = new EvaluationSuitesResource(this.http);
    this.evaluationRuns = new EvaluationRunsResource(this.http);
    this.officeWorkers = new OfficeWorkersResource(this.http);
    this.roles = new RolesResource(this.http);
    this.teams = new TeamsResource(this.http);
    this.goals = new GoalsResource(this.http);
    this.assignments = new AssignmentsResource(this.http);
  }
}
