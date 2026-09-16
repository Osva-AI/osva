import type { WorkspaceId } from "@osva/contracts";

import { OsvaHttpClient, type OsvaHttpClientOptions } from "./http-client.js";
import { AgentsResource } from "./resources/agents.js";
import { ApprovalsResource } from "./resources/approvals.js";
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
  }
}
