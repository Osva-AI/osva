import type {
  WorkflowDefinitionWaitConfigurationV3,
  WorkflowNodeRunId,
} from "@osva/contracts";
import {
  WORKFLOW_EVENT_TIMEOUT_ERROR_CODE,
  DomainInvariantError,
  LifecycleConflictError,
  WorkflowNodeRun,
  armWorkflowWait,
  buildWorkflowGraph,
  hasSameWorkflowWaitArm,
  inputForNode,
  isNodeReady,
  isTerminalWorkflowNodeRunState,
  isTerminalWorkflowRunState,
  nodeRunsByKey,
  type WorkflowGraph,
  type WorkflowRepository,
  type WorkflowRun,
  type WorkflowRunError,
  type WorkflowRunRepository,
  type WorkflowWaitRepository,
} from "@osva/domain";

export interface WorkflowWaitReconciliationIds {
  createWorkflowNodeRunId(): WorkflowNodeRunId;
}

export interface WorkflowWaitReconciliationCommand {
  readonly workflowRun: WorkflowRun;
  readonly now: Date;
  readonly ids: WorkflowWaitReconciliationIds;
}

export interface WorkflowWaitReconciliationDependencies {
  readonly workflows: WorkflowRepository;
  readonly workflowRuns: WorkflowRunRepository;
  readonly workflowWaits: WorkflowWaitRepository;
}

/**
 * WAIT arming and resolution observation for workflow reconciliation.
 * Wired into ReconcileWorkflowRun when V3 execution opens (Stage 3.3.17).
 *
 * OSS v1 accepts separate durable steps for WorkflowNodeRun WAITING transition
 * and WorkflowWait insert; correctness relies on frozen nodeRun.startedAt as
 * armedAt and ensureWorkflowWait on retry.
 */
export class WorkflowWaitReconciliation {
  constructor(private readonly deps: WorkflowWaitReconciliationDependencies) {}

  async reconcile(command: WorkflowWaitReconciliationCommand): Promise<void> {
    await this.repairAndObserve(command);
    await this.materializeReady(command);
  }

  async repairAndObserve(
    command: WorkflowWaitReconciliationCommand,
  ): Promise<void> {
    const graph = await this.loadGraph(command.workflowRun);
    if (graph === null) {
      return;
    }

    const workflowRun = await this.reloadWorkflowRun(command.workflowRun.id);
    if (
      workflowRun === null ||
      isTerminalWorkflowRunState(workflowRun.status)
    ) {
      return;
    }

    await this.ensureWaitingWorkflowWaits(graph, workflowRun);
    await this.observeResolvedWorkflowWaits(graph, command);
  }

  async materializeReady(
    command: WorkflowWaitReconciliationCommand,
  ): Promise<void> {
    const graph = await this.loadGraph(command.workflowRun);
    if (graph === null) {
      return;
    }

    const workflowRun = await this.reloadWorkflowRun(command.workflowRun.id);
    if (
      workflowRun === null ||
      isTerminalWorkflowRunState(workflowRun.status)
    ) {
      return;
    }

    await this.materializeReadyWorkflowWaits(graph, command);
  }

  private async loadGraph(
    workflowRun: WorkflowRun,
  ): Promise<WorkflowGraph | null> {
    const version = await this.deps.workflows.findWorkflowVersionById(
      workflowRun.workflowVersionId,
    );
    if (version === null) {
      throw new DomainInvariantError(
        `WorkflowVersion '${workflowRun.workflowVersionId}' was not found.`,
      );
    }

    return buildWorkflowGraph(version.definition);
  }

  private async ensureWaitingWorkflowWaits(
    graph: WorkflowGraph,
    workflowRun: WorkflowRun,
  ): Promise<void> {
    if (isTerminalWorkflowRunState(workflowRun.status)) {
      return;
    }

    const nodeRuns = nodeRunsByKey(
      await this.deps.workflowRuns.listWorkflowNodeRuns(workflowRun.id),
    );

    await Promise.all(
      [...nodeRuns.values()].map(async (nodeRun) => {
        const waitConfig = waitConfigurationForNode(
          graph,
          nodeRun.workflowNodeKey,
        );
        if (waitConfig === null || nodeRun.status !== "WAITING") {
          return;
        }

        if (isTerminalWorkflowNodeRunState(nodeRun.status)) {
          return;
        }

        await this.ensureWorkflowWait(nodeRun, waitConfig, workflowRun);
      }),
    );
  }

  private async observeResolvedWorkflowWaits(
    graph: WorkflowGraph,
    command: WorkflowWaitReconciliationCommand,
  ): Promise<void> {
    const workflowRun = await this.reloadWorkflowRun(command.workflowRun.id);
    if (
      workflowRun === null ||
      isTerminalWorkflowRunState(workflowRun.status)
    ) {
      return;
    }

    const nodeRuns = await this.deps.workflowRuns.listWorkflowNodeRuns(
      workflowRun.id,
    );

    await Promise.all(
      nodeRuns.map(async (nodeRun) => {
        const node = graph.nodesByKey.get(nodeRun.workflowNodeKey);
        if (node?.type !== "WAIT" || nodeRun.status !== "WAITING") {
          return;
        }

        if (isTerminalWorkflowNodeRunState(nodeRun.status)) {
          return;
        }

        const wait =
          await this.deps.workflowWaits.findWorkflowWaitByWorkflowNodeRunId(
            nodeRun.id,
          );
        if (wait === null || wait.resolution === undefined) {
          return;
        }

        if (wait.resolution === "CANCELLED") {
          return;
        }

        if (wait.resolution === "TIMER" || wait.resolution === "EVENT") {
          await this.transitionNode(
            nodeRun,
            nodeRun.markSucceeded(command.now, nodeRun.input),
          );
          return;
        }

        if (wait.resolution === "TIMEOUT") {
          await this.transitionNode(
            nodeRun,
            nodeRun.markFailed(command.now, workflowEventTimeoutError()),
          );
        }
      }),
    );
  }

  private async materializeReadyWorkflowWaits(
    graph: WorkflowGraph,
    command: WorkflowWaitReconciliationCommand,
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
      return node.type === "WAIT" && isNodeReady(graph, key, nodeRuns);
    });

    await Promise.all(
      ready.map(async ([nodeKey]) => {
        const waitConfig = waitConfigurationForNode(graph, nodeKey);
        if (waitConfig === null) {
          return;
        }

        const nodeRun =
          nodeRuns.get(nodeKey) ??
          (await this.materializeNodeRun({
            workflowRun,
            nodeKey,
            sequence: graph.sequenceByKey.get(nodeKey) ?? 1,
            input: inputForNode(graph, nodeKey, nodeRuns, workflowRun.input),
            now: command.now,
            ids: command.ids,
          }));

        if (isTerminalWorkflowNodeRunState(nodeRun.status)) {
          return;
        }

        await this.activateWaitNode(nodeRun, waitConfig, workflowRun, command);
      }),
    );
  }

  private async activateWaitNode(
    nodeRun: WorkflowNodeRun,
    waitConfig: WorkflowDefinitionWaitConfigurationV3,
    workflowRun: WorkflowRun,
    command: WorkflowWaitReconciliationCommand,
  ): Promise<void> {
    let current = nodeRun;
    if (current.status === "PENDING") {
      const waiting = await this.transitionNode(
        current,
        current.markWaiting(command.now),
      );
      if (waiting === null) {
        return;
      }

      current = waiting;
    }

    if (current.status !== "WAITING") {
      return;
    }

    await this.ensureWorkflowWait(current, waitConfig, workflowRun);
  }

  private async ensureWorkflowWait(
    nodeRun: WorkflowNodeRun,
    waitConfig: WorkflowDefinitionWaitConfigurationV3,
    workflowRun: WorkflowRun,
  ): Promise<void> {
    if (isTerminalWorkflowRunState(workflowRun.status)) {
      return;
    }

    if (isTerminalWorkflowNodeRunState(nodeRun.status)) {
      return;
    }

    if (nodeRun.status !== "WAITING") {
      return;
    }

    if (nodeRun.startedAt === undefined) {
      throw new DomainInvariantError(
        `WAITING WorkflowNodeRun '${nodeRun.id}' requires startedAt for WorkflowWait arming.`,
      );
    }

    const expected = armWorkflowWait({
      workspaceId: nodeRun.workspaceId,
      workflowRunId: nodeRun.workflowRunId,
      workflowNodeRunId: nodeRun.id,
      workflowRunCreatedAt: workflowRun.createdAt,
      wait: waitConfig,
      nodeInput: nodeRun.input,
      armedAt: nodeRun.startedAt,
    });

    const existing =
      await this.deps.workflowWaits.findWorkflowWaitByWorkflowNodeRunId(
        nodeRun.id,
      );
    if (existing !== null) {
      assertEquivalentWorkflowWaitArm(existing, expected);
      return;
    }

    try {
      await this.deps.workflowWaits.saveWorkflowWait(expected);
    } catch (error) {
      if (
        error instanceof DomainInvariantError &&
        error.message.includes("already exists")
      ) {
        const recovered =
          await this.deps.workflowWaits.findWorkflowWaitByWorkflowNodeRunId(
            nodeRun.id,
          );
        if (recovered !== null) {
          assertEquivalentWorkflowWaitArm(recovered, expected);
          return;
        }
      }

      throw error;
    }
  }

  private async materializeNodeRun(input: {
    readonly workflowRun: WorkflowRun;
    readonly nodeKey: string;
    readonly sequence: number;
    readonly input: unknown;
    readonly now: Date;
    readonly ids: WorkflowWaitReconciliationIds;
  }): Promise<WorkflowNodeRun> {
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

  private async reloadWorkflowRun(
    workflowRunId: WorkflowRun["id"],
  ): Promise<WorkflowRun | null> {
    return this.deps.workflowRuns.findWorkflowRunById(workflowRunId);
  }
}

function waitConfigurationForNode(
  graph: WorkflowGraph,
  nodeKey: string,
): WorkflowDefinitionWaitConfigurationV3 | null {
  const node = graph.nodesByKey.get(nodeKey);
  if (node?.type !== "WAIT") {
    return null;
  }

  return node.wait;
}

function assertEquivalentWorkflowWaitArm(
  persisted: ReturnType<typeof armWorkflowWait>,
  expected: ReturnType<typeof armWorkflowWait>,
): void {
  if (!hasSameWorkflowWaitArm(persisted, expected)) {
    throw new DomainInvariantError(
      `WorkflowWait arm mismatch for WorkflowNodeRun '${expected.workflowNodeRunId}'.`,
    );
  }
}

function workflowEventTimeoutError(): WorkflowRunError {
  return {
    code: WORKFLOW_EVENT_TIMEOUT_ERROR_CODE,
    message: "The workflow event wait timed out.",
  };
}
