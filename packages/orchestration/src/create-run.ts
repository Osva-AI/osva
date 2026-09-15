import type { JobQueue } from "@osva/contracts";
import type {
  AgentId,
  RunAttemptId,
  RunId,
  WorkspaceId,
} from "@osva/contracts";
import {
  Run,
  RunAttempt,
  type AgentRepository,
  type EffectiveRunBindings,
  type RunRepository,
} from "@osva/domain";

import {
  AgentNotFoundError,
  AgentVersionNotFoundError,
  BindingMismatchError,
  EnqueueFailedError,
} from "./errors.js";

export interface CreateRunCommand {
  readonly runId: RunId;
  readonly runAttemptId: RunAttemptId;
  readonly workspaceId: WorkspaceId;
  readonly agentId: AgentId;
  readonly effectiveBindings: EffectiveRunBindings;
  readonly input: unknown;
  readonly idempotencyKey?: string;
  readonly now: Date;
}

export interface CreateRunDependencies {
  readonly runs: RunRepository;
  readonly agents: AgentRepository;
  readonly queue: JobQueue;
}

export interface CreateRunResult {
  readonly run: Run;
  readonly runAttempt: RunAttempt;
}

/**
 * Persist-then-enqueue Run creation.
 *
 * Ordering: save PENDING Run, save first PENDING RunAttempt, transition
 * PENDING → QUEUED, save the QUEUED Run, then enqueue `{ runAttemptId }`.
 * The queue never creates RunAttempts.
 *
 * Stage 0 has no transactional outbox. If enqueue fails, durable QUEUED
 * Run + PENDING attempt rows remain so history is recoverable; CreateRun
 * still fails rather than reporting distributed execution as started.
 *
 * Agent/AgentVersion ownership is checked through AgentRepository before
 * any Run or RunAttempt is created or persisted. PostgreSQL foreign keys
 * remain defense-in-depth; they are not the CreateRun validation path.
 */
export class CreateRun {
  constructor(private readonly deps: CreateRunDependencies) {}

  async execute(command: CreateRunCommand): Promise<CreateRunResult> {
    await this.assertAgentOwnership(command);

    const pending = Run.create({
      id: command.runId,
      workspaceId: command.workspaceId,
      agentId: command.agentId,
      effectiveBindings: command.effectiveBindings,
      input: command.input,
      createdAt: command.now,
      idempotencyKey: command.idempotencyKey,
    });
    const attempt = RunAttempt.createFirst({
      id: command.runAttemptId,
      runId: pending.id,
      createdAt: command.now,
    });

    await this.deps.runs.saveRun(pending);
    await this.deps.runs.saveRunAttempt(attempt);

    const queued = pending.transitionTo("QUEUED", command.now);
    await this.deps.runs.saveRun(queued);

    try {
      await this.deps.queue.enqueue(attempt.id);
    } catch (error) {
      throw new EnqueueFailedError(queued.id, attempt.id, error);
    }

    return { run: queued, runAttempt: attempt };
  }

  private async assertAgentOwnership(command: CreateRunCommand): Promise<void> {
    const agent = await this.deps.agents.findAgentById(command.agentId);
    if (agent === null) {
      throw new AgentNotFoundError(command.agentId);
    }

    if (agent.workspaceId !== command.workspaceId) {
      throw new BindingMismatchError(
        `Agent ${agent.id} belongs to workspace ${agent.workspaceId}, not ${command.workspaceId}.`,
      );
    }

    const agentVersionId = command.effectiveBindings.agentVersionId;
    const agentVersion =
      await this.deps.agents.findAgentVersionById(agentVersionId);
    if (agentVersion === null) {
      throw new AgentVersionNotFoundError(
        `AgentVersion ${agentVersionId} was not found.`,
      );
    }

    if (agentVersion.agentId !== command.agentId) {
      throw new BindingMismatchError(
        `AgentVersion ${agentVersion.id} belongs to Agent ${agentVersion.agentId}, not ${command.agentId}.`,
      );
    }

    if (agentVersion.id !== agentVersionId) {
      throw new BindingMismatchError(
        `Effective bindings require AgentVersion ${agentVersionId}, but loaded AgentVersion is ${agentVersion.id}.`,
      );
    }
  }
}
