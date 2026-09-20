import type {
  AgentVersionId,
  KnowledgeIndexId,
  MemoryNamespaceBinding,
  ModelProfileVersionId,
  ToolVersionId,
} from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { freezeRecord } from "./internals.js";

export interface EffectiveRunBindingsProps {
  readonly agentVersionId: AgentVersionId;
  readonly modelProfileVersionBindings: Readonly<
    Record<string, ModelProfileVersionId>
  >;
  readonly toolVersionBindings: Readonly<Record<string, ToolVersionId>>;
  readonly memoryNamespaceBindings: Readonly<
    Record<string, MemoryNamespaceBinding>
  >;
  readonly knowledgeIndexBindings?: Readonly<
    Record<string, readonly KnowledgeIndexId[]>
  >;
}

export class EffectiveRunBindings {
  readonly agentVersionId: AgentVersionId;
  readonly modelProfileVersionBindings: Readonly<
    Record<string, ModelProfileVersionId>
  >;
  readonly toolVersionBindings: Readonly<Record<string, ToolVersionId>>;
  readonly memoryNamespaceBindings: Readonly<
    Record<string, MemoryNamespaceBinding>
  >;
  readonly knowledgeIndexBindings: Readonly<
    Record<string, readonly KnowledgeIndexId[]>
  >;

  private constructor(props: EffectiveRunBindingsProps) {
    this.agentVersionId = props.agentVersionId;
    this.modelProfileVersionBindings = props.modelProfileVersionBindings;
    this.toolVersionBindings = props.toolVersionBindings;
    this.memoryNamespaceBindings = props.memoryNamespaceBindings;
    this.knowledgeIndexBindings =
      props.knowledgeIndexBindings ?? Object.freeze({});
  }

  static create(props: EffectiveRunBindingsProps): EffectiveRunBindings {
    if (!props.agentVersionId) {
      throw new DomainInvariantError(
        "EffectiveRunBindings.agentVersionId is required.",
      );
    }

    if (
      props.modelProfileVersionBindings === null ||
      typeof props.modelProfileVersionBindings !== "object" ||
      Array.isArray(props.modelProfileVersionBindings)
    ) {
      throw new DomainInvariantError(
        "EffectiveRunBindings.modelProfileVersionBindings must be a map.",
      );
    }

    if (
      props.toolVersionBindings === null ||
      typeof props.toolVersionBindings !== "object" ||
      Array.isArray(props.toolVersionBindings)
    ) {
      throw new DomainInvariantError(
        "EffectiveRunBindings.toolVersionBindings must be a map.",
      );
    }

    if (
      props.memoryNamespaceBindings === null ||
      typeof props.memoryNamespaceBindings !== "object" ||
      Array.isArray(props.memoryNamespaceBindings)
    ) {
      throw new DomainInvariantError(
        "EffectiveRunBindings.memoryNamespaceBindings must be a map.",
      );
    }

    const rawKnowledge =
      props.knowledgeIndexBindings === undefined
        ? {}
        : props.knowledgeIndexBindings;

    if (
      rawKnowledge === null ||
      typeof rawKnowledge !== "object" ||
      Array.isArray(rawKnowledge)
    ) {
      throw new DomainInvariantError(
        "EffectiveRunBindings.knowledgeIndexBindings must be a map.",
      );
    }

    const knowledgeIndexBindings: Record<string, readonly KnowledgeIndexId[]> =
      {};
    for (const [name, ids] of Object.entries(rawKnowledge)) {
      if (!Array.isArray(ids)) {
        throw new DomainInvariantError(
          "EffectiveRunBindings.knowledgeIndexBindings values must be arrays.",
        );
      }
      knowledgeIndexBindings[name] = Object.freeze(
        ids.map((id) => id as KnowledgeIndexId),
      );
    }

    return Object.freeze(
      new EffectiveRunBindings({
        agentVersionId: props.agentVersionId,
        modelProfileVersionBindings: freezeRecord(
          props.modelProfileVersionBindings,
        ),
        toolVersionBindings: freezeRecord(props.toolVersionBindings),
        memoryNamespaceBindings: freezeRecord(props.memoryNamespaceBindings),
        knowledgeIndexBindings: Object.freeze(knowledgeIndexBindings),
      }),
    );
  }
}
