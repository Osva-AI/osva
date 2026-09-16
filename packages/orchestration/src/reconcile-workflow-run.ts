import type {
  AgentVersionId,
  JobQueue,
  RunAttemptId,
  RunId,
  WorkflowNodeRunId,
} from "@osva/contracts";
import {
  DomainInvariantError,
  isTerminalRunState,
  isTerminalWorkflowRunState,
  orderedSequentialNodeKeys,
  WorkflowNodeRun,
  type AgentRepository,
  type Run,
  type RunAttempt,
  type RunRepository,
  type WorkflowRepository,
  type WorkflowRun,
  type WorkflowRunError,
  type WorkflowRunRepository,
  type WorkflowVersion,
} from "@osva/domain";

import { CreateRun, type CreateRunCommand } from "./create-run.js";
import { EnqueueFailedError } from "./errors.js";
import { workflowNodeRunIdempotencyKey } from "./workflow-idempotency.js";

export interface ReconcileWorkflowRunIds {
  createRunId(): RunId;
  createRunAttemptId(): RunAttemptId;
  createWorkflowNodeRunId(): WorkflowNodeRunId;
}

export interface ReconcileWorkflowRunCommand {
  readonly workflowRun: WorkflowRun;
  readonly now: Date;
  readonly ids: ReconcileWorkflowRunIds;
}

export interface ReconcileWorkflowRunDependencies {
  readonly workflows: WorkflowRepository;
  readonly workflowRuns: WorkflowRunRepository;
  readonly agents: AgentRepository;
  readonly runs: RunRepository;
  readonly createRun: CreateRun;
  readonly queue: JobQueue;
  readonly logger?: {
    info(event: string, fields: Record<string, string>): void;
    error(event: string, fields: Record<string, string>): void;
  };
}

export class ReconcileWorkflowRun {
  constructor(private readonly deps: ReconcileWorkflowRunDependencies) {}

  async execute(command: ReconcileWorkflowRunCommand): Promise<void> {
    let workflowRun =
      (await this.deps.workflowRuns.findWorkflowRunById(
        command.workflowRun.id,
      )) ?? command.workflowRun;

    if (isTerminalWorkflowRunState(workflowRun.status)) {
      return;
    }

    const version = await this.deps.workflows.findWorkflowVersionById(
      workflowRun.workflowVersionId,
    );
    if (version === null) {
      throw new DomainInvariantError(
        `WorkflowRun ${workflowRun.id} references missing WorkflowVersion ${workflowRun.workflowVersionId}.`,
      );
    }

    const nodeKeys = orderedSequentialNodeKeys(version.definition);
    let nextInput: unknown = workflowRun.input;

    for (let index = 0; index < nodeKeys.length; index += 1) {
      const nodeKey = nodeKeys[index];
      if (nodeKey === undefined) {
        continue;
      }

      const latest = await this.deps.workflowRuns.findWorkflowRunById(
        workflowRun.id,
      );
      if (latest === null || isTerminalWorkflowRunState(latest.status)) {
        return;
      }
      workflowRun = latest;

      let nodeRun =
        await this.deps.workflowRuns.findWorkflowNodeRunByWorkflowRunAndKey(
          workflowRun.id,
          nodeKey,
        );

      if (nodeRun === null) {
        nodeRun = await this.materializeNodeRun({
          workflowRun,
          nodeKey,
          sequence: index + 1,
          input: nextInput,
          now: command.now,
          ids: command.ids,
        });
      }

      if (nodeRun.status === "FAILED") {
        await this.failWorkflow(
          workflowRun,
          nodeRun.error ?? childRunFailedError(nodeRun.childRunId),
          command.now,
        );
        return;
      }

      if (nodeRun.status === "SUCCEEDED") {
        nextInput = nodeRun.output ?? null;
        continue;
      }

      nodeRun = await this.ensureChildRun(
        workflowRun,
        version,
        nodeRun,
        command,
      );

      const observed = await this.observeChildRun(nodeRun, command.now);
      if (observed.outcome === "waiting") {
        return;
      }

      if (observed.outcome === "failed") {
        await this.failWorkflow(workflowRun, observed.error, command.now);
        return;
      }

      nextInput = observed.output;
    }

    const latest = await this.deps.workflowRuns.findWorkflowRunById(
      workflowRun.id,
    );
    if (latest === null || isTerminalWorkflowRunState(latest.status)) {
      return;
    }

    await this.succeedWorkflow(latest, nextInput, command.now);
  }

  private async materializeNodeRun(input: {
    readonly workflowRun: WorkflowRun;
    readonly nodeKey: string;
    readonly sequence: number;
    readonly input: unknown;
    readonly now: Date;
    readonly ids: ReconcileWorkflowRunIds;
  }): Promise<WorkflowNodeRun> {
    if (input.workflowRun.status === "PENDING") {
      await this.deps.workflowRuns.transitionWorkflowRun(
        "PENDING",
        input.workflowRun.markRunning(input.now),
      );
    }

    const nodeRun = WorkflowNodeRun.create({
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
    if (node === undefined) {
      throw new DomainInvariantError(
        `WorkflowVersion ${version.id} is missing node '${nodeRun.workflowNodeKey}'.`,
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
      nodeRun = await this.deps.workflowRuns.saveWorkflowNodeRunTransition(
        "PENDING",
        nodeRun.markRunning(command.now),
      );
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

    try {
      const created = await this.deps.createRun.execute(createCommand);
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
      currentRun = await this.deps.runs.transitionRun("PENDING", queued);
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
  ): Promise<
    | { readonly outcome: "waiting" }
    | { readonly outcome: "succeeded"; readonly output: unknown }
    | { readonly outcome: "failed"; readonly error: WorkflowRunError }
  > {
    if (nodeRun.childRunId === undefined) {
      return { outcome: "waiting" };
    }

    const run = await this.deps.runs.findRunById(nodeRun.childRunId);
    if (run === null) {
      return { outcome: "waiting" };
    }

    if (run.status === "SUCCEEDED") {
      const attempts = await this.deps.runs.listRunAttempts(run.id);
      const succeeded = attempts.find(
        (attempt) => attempt.status === "SUCCEEDED",
      );
      const output = succeeded?.output ?? null;
      if (nodeRun.status !== "SUCCEEDED") {
        await this.deps.workflowRuns.saveWorkflowNodeRunTransition(
          nodeRun.status,
          nodeRun.markSucceeded(now, output),
        );
      }
      return { outcome: "succeeded", output };
    }

    if (
      run.status === "FAILED" ||
      run.status === "TIMED_OUT" ||
      run.status === "CANCELLED"
    ) {
      const error = childRunFailedError(run.id, run.status);
      if (nodeRun.status !== "FAILED") {
        await this.deps.workflowRuns.saveWorkflowNodeRunTransition(
          nodeRun.status,
          nodeRun.markFailed(now, error),
        );
      }
      return { outcome: "failed", error };
    }

    return { outcome: "waiting" };
  }

  private async succeedWorkflow(
    workflowRun: WorkflowRun,
    output: unknown,
    now: Date,
  ): Promise<void> {
    if (workflowRun.status === "PENDING") {
      workflowRun = await this.deps.workflowRuns.transitionWorkflowRun(
        "PENDING",
        workflowRun.markRunning(now),
      );
    }

    if (workflowRun.status !== "RUNNING") {
      return;
    }

    await this.deps.workflowRuns.transitionWorkflowRun(
      "RUNNING",
      workflowRun.markSucceeded(now, output),
    );
  }

  private async failWorkflow(
    workflowRun: WorkflowRun,
    error: WorkflowRunError,
    now: Date,
  ): Promise<void> {
    const latest = await this.deps.workflowRuns.findWorkflowRunById(
      workflowRun.id,
    );
    if (latest === null || isTerminalWorkflowRunState(latest.status)) {
      return;
    }

    let current = latest;
    if (current.status === "PENDING") {
      current = await this.deps.workflowRuns.transitionWorkflowRun(
        "PENDING",
        current.markRunning(now),
      );
    }

    if (current.status !== "RUNNING") {
      return;
    }

    await this.deps.workflowRuns.transitionWorkflowRun(
      "RUNNING",
      current.markFailed(now, error),
    );
  }
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
