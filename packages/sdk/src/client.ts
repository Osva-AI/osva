import type { WorkspaceId } from "@osva/contracts";

import { OsvaHttpClient, type OsvaHttpClientOptions } from "./http-client.js";
import { AgentsResource } from "./resources/agents.js";
import { ApprovalsResource } from "./resources/approvals.js";
import {
  EvaluationRunsResource,
  EvaluationSuitesResource,
} from "./resources/evaluation.js";
import { MemoryNamespacesResource } from "./resources/memory-namespaces.js";
import { RunsResource } from "./resources/runs.js";
import { SchedulesResource } from "./resources/schedules.js";
import { WorkflowRunsResource } from "./resources/workflow-runs.js";
import { WorkflowsResource } from "./resources/workflows.js";

export interface OsvaClientOptions extends OsvaHttpClientOptions {
  readonly workspaceId: WorkspaceId;
}

export class OsvaClient {
  readonly workspaceId: WorkspaceId;
  readonly agents: AgentsResource;
  readonly runs: RunsResource;
  readonly workflows: WorkflowsResource;
  readonly workflowRuns: WorkflowRunsResource;
  readonly approvals: ApprovalsResource;
  readonly schedules: SchedulesResource;
  readonly memoryNamespaces: MemoryNamespacesResource;
  readonly evaluationSuites: EvaluationSuitesResource;
  readonly evaluationRuns: EvaluationRunsResource;

  private readonly http: OsvaHttpClient;

  constructor(options: OsvaClientOptions) {
    this.workspaceId = options.workspaceId;
    this.http = new OsvaHttpClient(options);
    this.agents = new AgentsResource(this.http);
    this.runs = new RunsResource(this.http, options.workspaceId);
    this.workflows = new WorkflowsResource(this.http);
    this.workflowRuns = new WorkflowRunsResource(
      this.http,
      options.workspaceId,
    );
    this.approvals = new ApprovalsResource(this.http, options.workspaceId);
    this.schedules = new SchedulesResource(this.http, options.workspaceId);
    this.memoryNamespaces = new MemoryNamespacesResource(this.http);
    this.evaluationSuites = new EvaluationSuitesResource(this.http);
    this.evaluationRuns = new EvaluationRunsResource(
      this.http,
      options.workspaceId,
    );
  }
}
