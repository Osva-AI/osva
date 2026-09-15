import type { AgentVersionId, ModelProfileVersionId } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { freezeRecord } from "./internals.js";

export interface EffectiveRunBindingsProps {
  readonly agentVersionId: AgentVersionId;
  readonly modelProfileVersionBindings: Readonly<
    Record<string, ModelProfileVersionId>
  >;
}

export class EffectiveRunBindings {
  readonly agentVersionId: AgentVersionId;
  readonly modelProfileVersionBindings: Readonly<
    Record<string, ModelProfileVersionId>
  >;

  private constructor(props: EffectiveRunBindingsProps) {
    this.agentVersionId = props.agentVersionId;
    this.modelProfileVersionBindings = props.modelProfileVersionBindings;
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

    return Object.freeze(
      new EffectiveRunBindings({
        agentVersionId: props.agentVersionId,
        modelProfileVersionBindings: freezeRecord(
          props.modelProfileVersionBindings,
        ),
      }),
    );
  }
}
