import type {
  AgentVersionId,
  ApprovalRequestId,
  JobQueue,
  RunAttemptId,
  RunId,
  WorkflowDefinitionNodeV1,
  WorkflowDefinitionNodeV2,
  WorkflowNodeRunId,
} from "@osva/contracts";
import {
  APPROVAL_REJECTED_ERROR_CODE,
  ApprovalRequest,
  DomainInvariantError,
  LifecycleConflictError,
  WorkflowNodeRun,
  buildWorkflowGraph,
  hasFailedNode,
  inputForNode,
  isNodeReady,
  isNodeSkippable,
  isTerminalRunState,
  isTerminalWorkflowNodeRunState,
  isTerminalWorkflowRunState,
  isWorkflowBlockedOnApproval,
  nodeRunsByKey,
  selectBranchTarget,
  type AgentRepository,
  type ApprovalRequestRepository,
  type Run,
  type RunAttempt,
  type RunRepository,
  type WorkflowGraph,
  type WorkflowRepository,
  type WorkflowRun,
  type WorkflowRunError,
  type WorkflowRunRepository,
  type WorkflowVersion,
} from "@osva/domain";

import {
  OSVA_ATTR,
  OSVA_METRIC,
  OSVA_SPAN,
  resolveInstrumentation,
  type OsvaInstrumentation,
} from "@osva/observability";

import { CreateRun, type CreateRunCommand } from "./create-run.js";
import { EnqueueFailedError } from "./errors.js";
import { workflowNodeRunIdempotencyKey } from "./workflow-idempotency.js";

export interface ReconcileWorkflowRunIds {
  createRunId(): RunId;
  createRunAttemptId(): RunAttemptId;
  createWorkflowNodeRunId(): WorkflowNodeRunId;
  createApprovalRequestId(): ApprovalRequestId;
}

export interface ReconcileWorkflowRunCommand {
  readonly workflowRun: WorkflowRun;
  readonly now: Date;
  readonly ids: ReconcileWorkflowRunIds;
}

export interface ReconcileWorkflowRunDependencies {
  readonly workflows: WorkflowRepository;
  readonly workflowRuns: WorkflowRunRepository;
  readonly approvalRequests: ApprovalRequestRepository;
  readonly agents: AgentRepository;
  readonly runs: RunRepository;
  readonly createRun: CreateRun;
  readonly queue: JobQueue;
  readonly instrumentation?: OsvaInstrumentation;
  readonly logger?: {
    info(event: string, fields: Record<string, string>): void;
    error(event: string, fields: Record<string, string>): void;
  };
}

export class ReconcileWorkflowRun {
  constructor(private readonly deps: ReconcileWorkflowRunDependencies) {}

  async execute(command: ReconcileWorkflowRunCommand): Promise<void> {
    const telemetry = resolveInstrumentation(this.deps.instrumentation);

    await telemetry.withSpan(
      OSVA_SPAN.WORKFLOW_RECONCILE,
      {
        [OSVA_ATTR.WORKFLOW_RUN_ID]: command.workflowRun.id,
        [OSVA_ATTR.WORKFLOW_VERSION_ID]: command.workflowRun.workflowVersionId,
      },
      async () => {
        await this.executeInner(command);
        telemetry.recordCounter(OSVA_METRIC.WORKFLOW_RECONCILIATIONS, 1);
      },
    );
  }

  private async executeInner(
    command: ReconcileWorkflowRunCommand,
  ): Promise<void> {
    const version = await this.loadVersion(
      command.workflowRun.workflowVersionId,
    );
    const graph = buildWorkflowGraph(version.definition);

    await this.observeExistingAgents(graph, command);

    let workflowRun = await this.reloadWorkflowRun(command.workflowRun.id);
    if (workflowRun === null) {
      return;
    }

    const failed = hasFailedNode(
      nodeRunsByKey(
        await this.deps.workflowRuns.listWorkflowNodeRuns(workflowRun.id),
      ),
    );
    if (
      failed !== undefined &&
      !isTerminalWorkflowRunState(workflowRun.status)
    ) {
      await this.failWorkflow(
        workflowRun,
        failed.error ?? childRunFailedError(failed.childRunId),
        command.now,
      );
      return;
    }

    workflowRun = await this.reloadWorkflowRun(command.workflowRun.id);
    if (
      workflowRun === null ||
      isTerminalWorkflowRunState(workflowRun.status)
    ) {
      return;
    }

    await this.observeApprovalDecisions(graph, command);

    workflowRun = await this.reloadWorkflowRun(command.workflowRun.id);
    if (
      workflowRun === null ||
      isTerminalWorkflowRunState(workflowRun.status)
    ) {
      return;
    }

    const failedAfterApproval = hasFailedNode(
      nodeRunsByKey(
        await this.deps.workflowRuns.listWorkflowNodeRuns(workflowRun.id),
      ),
    );
    if (failedAfterApproval !== undefined) {
      await this.failWorkflow(
        workflowRun,
        failedAfterApproval.error ??
          childRunFailedError(failedAfterApproval.childRunId),
        command.now,
      );
      return;
    }

    workflowRun = await this.reloadWorkflowRun(command.workflowRun.id);
    if (
      workflowRun === null ||
      isTerminalWorkflowRunState(workflowRun.status)
    ) {
      return;
    }

    await this.propagateSkips(graph, command);
    await this.resolveOrchestrationNodes(graph, command);
    await this.propagateSkips(graph, command);
    await this.materializeReadyApprovals(graph, command);
    await this.startReadyAgents(graph, version, command);

    workflowRun = await this.reloadWorkflowRun(command.workflowRun.id);
    if (
      workflowRun === null ||
      isTerminalWorkflowRunState(workflowRun.status)
    ) {
      return;
    }

    const nodeRuns = nodeRunsByKey(
      await this.deps.workflowRuns.listWorkflowNodeRuns(workflowRun.id),
    );
    const laterFailure = hasFailedNode(nodeRuns);
    if (laterFailure !== undefined) {
      await this.failWorkflow(
        workflowRun,
        laterFailure.error ?? childRunFailedError(laterFailure.childRunId),
        command.now,
      );
      return;
    }

    const terminal = nodeRuns.get(graph.terminalKey);
    if (terminal?.status === "SUCCEEDED") {
      await this.succeedWorkflow(
        workflowRun,
        terminal.output ?? null,
        command.now,
      );
      return;
    }

    if (terminal?.status === "SKIPPED") {
      await this.failWorkflow(
        workflowRun,
        {
          code: "WORKFLOW_TERMINAL_SKIPPED",
          message: `Terminal workflow node '${graph.terminalKey}' was skipped.`,
        },
        command.now,
      );
      return;
    }

    await this.deriveActiveWorkflowStatus(
      graph,
      workflowRun,
      nodeRuns,
      command.now,
    );
  }

  private async loadVersion(
    id: WorkflowVersion["id"],
  ): Promise<WorkflowVersion> {
    const version = await this.deps.workflows.findWorkflowVersionById(id);
    if (version === null) {
      throw new DomainInvariantError(
        `WorkflowRun references missing WorkflowVersion ${id}.`,
      );
    }

    return version;
  }

  private async reloadWorkflowRun(
    id: WorkflowRun["id"],
  ): Promise<WorkflowRun | null> {
    return this.deps.workflowRuns.findWorkflowRunById(id);
  }

  private async observeExistingAgents(
    graph: WorkflowGraph,
    command: ReconcileWorkflowRunCommand,
  ): Promise<void> {
    const nodeRuns = await this.deps.workflowRuns.listWorkflowNodeRuns(
      command.workflowRun.id,
    );
    const version = await this.loadVersion(
      command.workflowRun.workflowVersionId,
    );

    await Promise.all(
      nodeRuns.map(async (nodeRun) => {
        const node = graph.nodesByKey.get(nodeRun.workflowNodeKey);
        if (
          node?.type !== "AGENT" ||
          isTerminalWorkflowNodeRunState(nodeRun.status)
        ) {
          return;
        }

        await this.processAgentNode(version, nodeRun, command);
      }),
    );
  }

  private async propagateSkips(
    graph: WorkflowGraph,
    command: ReconcileWorkflowRunCommand,
  ): Promise<void> {
    const workflowRun = await this.reloadWorkflowRun(command.workflowRun.id);
    if (
      workflowRun === null ||
      isTerminalWorkflowRunState(workflowRun.status)
    ) {
      return;
    }

    const nodeRuns = nodeRunsByKey(
      await this.deps.workflowRuns.listWorkflowNodeRuns(workflowRun.id),
    );

    await Promise.all(
      [...graph.nodesByKey.keys()].map(async (nodeKey) => {
        if (!isNodeSkippable(graph, nodeKey, nodeRuns)) {
          return;
        }

        const existing = nodeRuns.get(nodeKey);
        if (existing === undefined) {
          await this.materializeNodeRun({
            workflowRun,
            nodeKey,
            sequence: graph.sequenceByKey.get(nodeKey) ?? 1,
            input: inputForNode(graph, nodeKey, nodeRuns, workflowRun.input),
            now: command.now,
            ids: command.ids,
            skipped: true,
          });
          return;
        }

        if (existing.status === "PENDING") {
          await this.transitionNode(
            existing,
            existing.markSkipped(command.now),
          );
        }
      }),
    );
  }

  private async resolveOrchestrationNodes(
    graph: WorkflowGraph,
    command: ReconcileWorkflowRunCommand,
  ): Promise<void> {
    const limit = graph.nodesByKey.size;
    for (let step = 0; step < limit; step += 1) {
      const workflowRun = await this.reloadWorkflowRun(command.workflowRun.id);
      if (
        workflowRun === null ||
        isTerminalWorkflowRunState(workflowRun.status)
      ) {
        return;
      }

      const nodeRuns = nodeRunsByKey(
        await this.deps.workflowRuns.listWorkflowNodeRuns(workflowRun.id),
      );
      const ready = [...graph.nodesByKey.entries()].filter(([key, node]) => {
        return (
          node.type !== "AGENT" &&
          node.type !== "APPROVAL" &&
          isNodeReady(graph, key, nodeRuns)
        );
      });

      if (ready.length === 0) {
        return;
      }

      await Promise.all(
        ready.map(([nodeKey, node]) =>
          this.resolveOrchestrationNode({
            graph,
            workflowRun,
            nodeKey,
            node,
            nodeRuns,
            command,
          }),
        ),
      );
      await this.propagateSkips(graph, command);
    }
  }

  private async resolveOrchestrationNode(input: {
    readonly graph: WorkflowGraph;
    readonly workflowRun: WorkflowRun;
    readonly nodeKey: string;
    readonly node: WorkflowDefinitionNodeV1 | WorkflowDefinitionNodeV2;
    readonly nodeRuns: ReadonlyMap<string, WorkflowNodeRun>;
    readonly command: ReconcileWorkflowRunCommand;
  }): Promise<void> {
    const nodeInput = inputForNode(
      input.graph,
      input.nodeKey,
      input.nodeRuns,
      input.workflowRun.input,
    );
    let nodeRun =
      input.nodeRuns.get(input.nodeKey) ??
      (await this.materializeNodeRun({
        workflowRun: input.workflowRun,
        nodeKey: input.nodeKey,
        sequence: input.graph.sequenceByKey.get(input.nodeKey) ?? 1,
        input: nodeInput,
        now: input.command.now,
        ids: input.command.ids,
        skipped: false,
      }));

    if (isTerminalWorkflowNodeRunState(nodeRun.status)) {
      return;
    }

    if (nodeRun.status === "PENDING") {
      const running = await this.transitionNode(
        nodeRun,
        nodeRun.markRunning(input.command.now),
      );
      if (running === null) {
        return;
      }

      nodeRun = running;
    }

    if (nodeRun.status !== "RUNNING") {
      return;
    }

    if (input.node.type === "BRANCH") {
      const selectedTargetKey = selectBranchTarget(input.node, nodeRun.input);
      await this.transitionNode(
        nodeRun,
        nodeRun.markSucceeded(
          input.command.now,
          nodeRun.input,
          selectedTargetKey,
        ),
      );
      return;
    }

    await this.transitionNode(
      nodeRun,
      nodeRun.markSucceeded(input.command.now, nodeRun.input),
    );
  }

  private async startReadyAgents(
    graph: WorkflowGraph,
    version: WorkflowVersion,
    command: ReconcileWorkflowRunCommand,
  ): Promise<void> {
    const workflowRun = await this.reloadWorkflowRun(command.workflowRun.id);
    if (
      workflowRun === null ||
      isTerminalWorkflowRunState(workflowRun.status)
    ) {
      return;
    }

    const nodeRuns = nodeRunsByKey(
      await this.deps.workflowRuns.listWorkflowNodeRuns(workflowRun.id),
    );
    const ready = [...graph.nodesByKey.entries()].filter(([key, node]) => {
      return node.type === "AGENT" && isNodeReady(graph, key, nodeRuns);
    });

    await Promise.all(
      ready.map(async ([nodeKey]) => {
        const nodeRun =
          nodeRuns.get(nodeKey) ??
          (await this.materializeNodeRun({
            workflowRun,
            nodeKey,
            sequence: graph.sequenceByKey.get(nodeKey) ?? 1,
            input: inputForNode(graph, nodeKey, nodeRuns, workflowRun.input),
            now: command.now,
            ids: command.ids,
            skipped: false,
          }));

        if (isTerminalWorkflowNodeRunState(nodeRun.status)) {
          return;
        }

        await this.processAgentNode(version, nodeRun, command);
      }),
    );
  }

  private async processAgentNode(
    version: WorkflowVersion,
    nodeRun: WorkflowNodeRun,
    command: ReconcileWorkflowRunCommand,
  ): Promise<void> {
    const workflowRun = await this.reloadWorkflowRun(nodeRun.workflowRunId);
    if (workflowRun === null) {
      return;
    }

    nodeRun = await this.ensureChildRun(workflowRun, version, nodeRun, command);
    await this.observeChildRun(nodeRun, command.now);
  }

  private async materializeNodeRun(input: {
    readonly workflowRun: WorkflowRun;
    readonly nodeKey: string;
    readonly sequence: number;
    readonly input: unknown;
    readonly now: Date;
    readonly ids: ReconcileWorkflowRunIds;
    readonly skipped: boolean;
  }): Promise<WorkflowNodeRun> {
    const nodeRun = input.skipped
      ? WorkflowNodeRun.createSkipped({
          id: input.ids.createWorkflowNodeRunId(),
          workspaceId: input.workflowRun.workspaceId,
          workflowRunId: input.workflowRun.id,
          workflowNodeKey: input.nodeKey,
          sequence: input.sequence,
          input: input.input,
          createdAt: input.now,
        })
      : WorkflowNodeRun.create({
          id: input.ids.createWorkflowNodeRunId(),
          workspaceId: input.workflowRun.workspaceId,
          workflowRunId: input.workflowRun.id,
          workflowNodeKey: input.nodeKey,
          sequence: input.sequence,
          input: input.input,
          createdAt: input.now,
        });

    try {
      await this.deps.workflowRuns.saveWorkflowNodeRun(nodeRun);
      return nodeRun;
    } catch (error) {
      if (
        error instanceof DomainInvariantError &&
        error.message.includes("already exists")
      ) {
        const existing =
          await this.deps.workflowRuns.findWorkflowNodeRunByWorkflowRunAndKey(
            input.workflowRun.id,
            input.nodeKey,
          );
        if (existing !== null) {
          return existing;
        }
      }

      throw error;
    }
  }

  private async ensureChildRun(
    workflowRun: WorkflowRun,
    version: WorkflowVersion,
    nodeRun: WorkflowNodeRun,
    command: ReconcileWorkflowRunCommand,
  ): Promise<WorkflowNodeRun> {
    const node = version.definition.nodes.find(
      (candidate) => candidate.key === nodeRun.workflowNodeKey,
    );
    if (node === undefined || node.type !== "AGENT") {
      throw new DomainInvariantError(
        `Workflow node '${nodeRun.workflowNodeKey}' is not an AGENT node.`,
      );
    }

    const idempotencyKey = workflowNodeRunIdempotencyKey(
      workflowRun.id,
      nodeRun.workflowNodeKey,
    );

    let run =
      (nodeRun.childRunId === undefined
        ? null
        : await this.deps.runs.findRunById(nodeRun.childRunId)) ??
      (await this.deps.runs.findRunByWorkspaceIdempotencyKey(
        workflowRun.workspaceId,
        idempotencyKey,
      ));

    let enqueuedByCreateRun = false;
    if (run === null) {
      const created = await this.createChildRun({
        workflowRun,
        nodeRun,
        agentVersionId: node.agentVersionId,
        idempotencyKey,
        command,
      });
      run = created.run;
      enqueuedByCreateRun = created.enqueued;
    }

    if (nodeRun.childRunId === undefined || nodeRun.childRunId !== run.id) {
      nodeRun = nodeRun.withChildRunId(run.id, command.now);
      await this.deps.workflowRuns.saveWorkflowNodeRun(nodeRun);
    }

    if (nodeRun.status === "PENDING") {
      const running = await this.transitionNode(
        nodeRun,
        nodeRun.markRunning(command.now),
      );
      if (running !== null) {
        nodeRun = running;
      }
    }

    if (
      enqueuedByCreateRun ||
      isTerminalRunState(run.status) ||
      run.status === "RUNNING"
    ) {
      return nodeRun;
    }

    const initialAttempt = await findInitialRunAttempt(this.deps.runs, run.id);
    if (initialAttempt === null) {
      throw new DomainInvariantError(
        `Workflow child Run ${run.id} is missing its initial RunAttempt.`,
      );
    }

    await this.enqueueInitialAttempt(run, initialAttempt, command.now);
    return nodeRun;
  }

  private async createChildRun(input: {
    readonly workflowRun: WorkflowRun;
    readonly nodeRun: WorkflowNodeRun;
    readonly agentVersionId: AgentVersionId;
    readonly idempotencyKey: string;
    readonly command: ReconcileWorkflowRunCommand;
  }): Promise<{ readonly run: Run; readonly enqueued: boolean }> {
    const agentVersion = await this.deps.agents.findAgentVersionById(
      input.agentVersionId,
    );
    if (agentVersion === null) {
      throw new DomainInvariantError(
        `Workflow node '${input.nodeRun.workflowNodeKey}' references unknown AgentVersion '${input.agentVersionId}'.`,
      );
    }

    const createCommand: CreateRunCommand = {
      runId: input.command.ids.createRunId(),
      runAttemptId: input.command.ids.createRunAttemptId(),
      workspaceId: input.workflowRun.workspaceId,
      agentId: agentVersion.agentId,
      agentVersionId: agentVersion.id,
      input: input.nodeRun.input,
      idempotencyKey: input.idempotencyKey,
      now: input.command.now,
    };

    const telemetry = resolveInstrumentation(this.deps.instrumentation);

    try {
      const created = await telemetry.withSpan(
        OSVA_SPAN.WORKFLOW_NODE_EXECUTE,
        {
          [OSVA_ATTR.WORKFLOW_RUN_ID]: input.workflowRun.id,
          [OSVA_ATTR.WORKFLOW_NODE_RUN_ID]: input.nodeRun.id,
          [OSVA_ATTR.AGENT_VERSION_ID]: input.agentVersionId,
        },
        async () => this.deps.createRun.execute(createCommand),
      );
      return { run: created.run, enqueued: true };
    } catch (error) {
      if (
        error instanceof DomainInvariantError &&
        error.message.includes("idempotency key")
      ) {
        const existing = await this.deps.runs.findRunByWorkspaceIdempotencyKey(
          input.workflowRun.workspaceId,
          input.idempotencyKey,
        );
        if (existing !== null) {
          return { run: existing, enqueued: false };
        }
      }

      if (error instanceof EnqueueFailedError) {
        this.deps.logger?.error("workflow.reconcile.enqueue_failed", {
          workflowRunId: input.workflowRun.id,
          workflowNodeKey: input.nodeRun.workflowNodeKey,
          runId: error.runId,
          runAttemptId: error.runAttemptId,
        });
        const existing = await this.deps.runs.findRunById(error.runId);
        if (existing !== null) {
          return { run: existing, enqueued: false };
        }
      }

      throw error;
    }
  }

  private async enqueueInitialAttempt(
    run: Run,
    initialAttempt: RunAttempt,
    now: Date,
  ): Promise<void> {
    let currentRun = run;

    if (currentRun.status === "PENDING") {
      const queued = currentRun.transitionTo("QUEUED", now);
      try {
        currentRun = await this.deps.runs.transitionRun("PENDING", queued);
      } catch (error) {
        if (error instanceof LifecycleConflictError) {
          return;
        }

        throw error;
      }
    }

    if (currentRun.status !== "QUEUED") {
      return;
    }

    try {
      await this.deps.queue.enqueue(initialAttempt.id);
    } catch (error) {
      this.deps.logger?.error("workflow.reconcile.enqueue_failed", {
        runId: currentRun.id,
        runAttemptId: initialAttempt.id,
        error: error instanceof Error ? error.name : "unknown_error",
      });
    }
  }

  private async observeChildRun(
    nodeRun: WorkflowNodeRun,
    now: Date,
  ): Promise<void> {
    if (nodeRun.childRunId === undefined) {
      return;
    }

    const run = await this.deps.runs.findRunById(nodeRun.childRunId);
    if (run === null) {
      return;
    }

    if (run.status === "SUCCEEDED") {
      const attempts = await this.deps.runs.listRunAttempts(run.id);
      const succeeded = attempts.find(
        (attempt) => attempt.status === "SUCCEEDED",
      );
      const output = succeeded?.output ?? null;
      if (nodeRun.status !== "SUCCEEDED") {
        await this.transitionNode(nodeRun, nodeRun.markSucceeded(now, output));
      }
      return;
    }

    if (
      run.status === "FAILED" ||
      run.status === "TIMED_OUT" ||
      run.status === "CANCELLED"
    ) {
      const error = childRunFailedError(run.id, run.status);
      if (nodeRun.status !== "FAILED") {
        await this.transitionNode(nodeRun, nodeRun.markFailed(now, error));
      }
    }
  }

  private async observeApprovalDecisions(
    graph: WorkflowGraph,
    command: ReconcileWorkflowRunCommand,
  ): Promise<void> {
    const nodeRuns = await this.deps.workflowRuns.listWorkflowNodeRuns(
      command.workflowRun.id,
    );

    await Promise.all(
      nodeRuns.map(async (nodeRun) => {
        const node = graph.nodesByKey.get(nodeRun.workflowNodeKey);
        if (
          node?.type !== "APPROVAL" ||
          nodeRun.status !== "WAITING_FOR_APPROVAL"
        ) {
          return;
        }

        const request =
          await this.deps.approvalRequests.findApprovalRequestByWorkflowNodeRunId(
            nodeRun.id,
          );
        if (request === null || request.status === "PENDING") {
          return;
        }

        if (request.status === "APPROVED") {
          await this.transitionNode(
            nodeRun,
            nodeRun.markSucceeded(command.now, nodeRun.input),
          );
          return;
        }

        await this.transitionNode(
          nodeRun,
          nodeRun.markFailed(command.now, approvalRejectedError()),
        );
      }),
    );
  }

  private async materializeReadyApprovals(
    graph: WorkflowGraph,
    command: ReconcileWorkflowRunCommand,
  ): Promise<void> {
    const workflowRun = await this.reloadWorkflowRun(command.workflowRun.id);
    if (
      workflowRun === null ||
      isTerminalWorkflowRunState(workflowRun.status)
    ) {
      return;
    }

    const nodeRuns = nodeRunsByKey(
      await this.deps.workflowRuns.listWorkflowNodeRuns(workflowRun.id),
    );
    const ready = [...graph.nodesByKey.entries()].filter(([key, node]) => {
      return node.type === "APPROVAL" && isNodeReady(graph, key, nodeRuns);
    });

    await Promise.all(
      ready.map(async ([nodeKey]) => {
        const nodeRun =
          nodeRuns.get(nodeKey) ??
          (await this.materializeNodeRun({
            workflowRun,
            nodeKey,
            sequence: graph.sequenceByKey.get(nodeKey) ?? 1,
            input: inputForNode(graph, nodeKey, nodeRuns, workflowRun.input),
            now: command.now,
            ids: command.ids,
            skipped: false,
          }));

        if (isTerminalWorkflowNodeRunState(nodeRun.status)) {
          return;
        }

        await this.activateApprovalNode(nodeRun, command);
      }),
    );
  }

  private async activateApprovalNode(
    nodeRun: WorkflowNodeRun,
    command: ReconcileWorkflowRunCommand,
  ): Promise<void> {
    let current = nodeRun;
    if (current.status === "PENDING") {
      const waiting = await this.transitionNode(
        current,
        current.markWaitingForApproval(command.now),
      );
      if (waiting === null) {
        return;
      }

      current = waiting;
    }

    if (current.status !== "WAITING_FOR_APPROVAL") {
      return;
    }

    await this.ensureApprovalRequest(current, command);
  }

  private async ensureApprovalRequest(
    nodeRun: WorkflowNodeRun,
    command: ReconcileWorkflowRunCommand,
  ): Promise<void> {
    const existing =
      await this.deps.approvalRequests.findApprovalRequestByWorkflowNodeRunId(
        nodeRun.id,
      );
    if (existing !== null) {
      return;
    }

    const request = ApprovalRequest.create({
      id: command.ids.createApprovalRequestId(),
      workspaceId: nodeRun.workspaceId,
      workflowRunId: nodeRun.workflowRunId,
      workflowNodeRunId: nodeRun.id,
      createdAt: command.now,
    });

    try {
      await this.deps.approvalRequests.saveApprovalRequest(request);
    } catch (error) {
      if (
        error instanceof DomainInvariantError &&
        error.message.includes("already exists")
      ) {
        const recovered =
          await this.deps.approvalRequests.findApprovalRequestByWorkflowNodeRunId(
            nodeRun.id,
          );
        if (recovered !== null) {
          return;
        }
      }

      throw error;
    }
  }

  private async deriveActiveWorkflowStatus(
    graph: WorkflowGraph,
    workflowRun: WorkflowRun,
    nodeRuns: ReadonlyMap<string, WorkflowNodeRun>,
    now: Date,
  ): Promise<void> {
    const latest = await this.reloadWorkflowRun(workflowRun.id);
    if (latest === null || isTerminalWorkflowRunState(latest.status)) {
      return;
    }

    const target = isWorkflowBlockedOnApproval(graph, nodeRuns)
      ? "WAITING_FOR_APPROVAL"
      : "RUNNING";
    if (latest.status === target) {
      return;
    }

    const next =
      target === "WAITING_FOR_APPROVAL"
        ? latest.markWaitingForApproval(now)
        : latest.markRunning(now);

    try {
      await this.deps.workflowRuns.transitionWorkflowRun(latest.status, next);
    } catch (error) {
      if (!(error instanceof LifecycleConflictError)) {
        throw error;
      }
    }
  }

  private async succeedWorkflow(
    workflowRun: WorkflowRun,
    output: unknown,
    now: Date,
  ): Promise<void> {
    const latest = await this.reloadWorkflowRun(workflowRun.id);
    if (latest === null || isTerminalWorkflowRunState(latest.status)) {
      return;
    }

    let current = latest;
    if (current.status === "PENDING") {
      try {
        current = await this.deps.workflowRuns.transitionWorkflowRun(
          "PENDING",
          current.markRunning(now),
        );
      } catch (error) {
        if (error instanceof LifecycleConflictError) {
          return;
        }

        throw error;
      }
    }

    if (
      current.status !== "RUNNING" &&
      current.status !== "WAITING_FOR_APPROVAL"
    ) {
      return;
    }

    try {
      await this.deps.workflowRuns.transitionWorkflowRun(
        current.status,
        current.markSucceeded(now, output),
      );
    } catch (error) {
      if (!(error instanceof LifecycleConflictError)) {
        throw error;
      }
    }
  }

  private async failWorkflow(
    workflowRun: WorkflowRun,
    error: WorkflowRunError,
    now: Date,
  ): Promise<void> {
    const latest = await this.reloadWorkflowRun(workflowRun.id);
    if (latest === null || isTerminalWorkflowRunState(latest.status)) {
      return;
    }

    const current = latest;
    if (current.status === "PENDING") {
      try {
        await this.deps.workflowRuns.transitionWorkflowRun(
          "PENDING",
          current.markFailed(now, error),
        );
      } catch (caught) {
        if (!(caught instanceof LifecycleConflictError)) {
          throw caught;
        }
      }
      return;
    }

    if (
      current.status !== "RUNNING" &&
      current.status !== "WAITING_FOR_APPROVAL"
    ) {
      return;
    }

    try {
      await this.deps.workflowRuns.transitionWorkflowRun(
        current.status,
        current.markFailed(now, error),
      );
    } catch (caught) {
      if (!(caught instanceof LifecycleConflictError)) {
        throw caught;
      }
    }
  }

  private async transitionNode(
    current: WorkflowNodeRun,
    next: WorkflowNodeRun,
  ): Promise<WorkflowNodeRun | null> {
    try {
      return await this.deps.workflowRuns.saveWorkflowNodeRunTransition(
        current.status,
        next,
      );
    } catch (error) {
      if (error instanceof LifecycleConflictError) {
        return this.deps.workflowRuns.findWorkflowNodeRunById(current.id);
      }

      throw error;
    }
  }
}

function approvalRejectedError(): WorkflowRunError {
  return {
    code: APPROVAL_REJECTED_ERROR_CODE,
    message: "The approval was rejected.",
  };
}

function childRunFailedError(
  runId: RunId | undefined,
  status: string = "FAILED",
): WorkflowRunError {
  return {
    code: "CHILD_RUN_FAILED",
    message:
      runId === undefined
        ? "A workflow node failed before a child Run was recorded."
        : `Child Run ${runId} terminated as ${status}.`,
  };
}

async function findInitialRunAttempt(
  runs: RunRepository,
  runId: RunId,
): Promise<RunAttempt | null> {
  const attempts = await runs.listRunAttempts(runId);
  return attempts.find((attempt) => attempt.sequence === 1) ?? null;
}
