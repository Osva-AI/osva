import type { JsonValue } from "@osva/contracts";
import type { MemoryNamespaceId } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export const MEMORY_RECORD_INITIAL_REVISION = 1;

export interface MemoryRecordProps {
  readonly namespaceId: MemoryNamespaceId;
  readonly key: string;
  readonly value: JsonValue;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class MemoryRecord {
  readonly namespaceId: MemoryNamespaceId;
  readonly key: string;
  readonly value: JsonValue;
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  private constructor(props: MemoryRecordProps) {
    this.namespaceId = props.namespaceId;
    this.key = props.key;
    this.value = props.value;
    this.revision = props.revision;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  static create(props: MemoryRecordProps): MemoryRecord {
    if (!props.namespaceId) {
      throw new DomainInvariantError("MemoryRecord.namespaceId is required.");
    }

    if (!Number.isInteger(props.revision) || props.revision < 1) {
      throw new DomainInvariantError(
        "MemoryRecord.revision must be a positive integer.",
      );
    }

    return Object.freeze(
      new MemoryRecord({
        namespaceId: props.namespaceId,
        key: requireNonEmptyString(props.key, "MemoryRecord.key"),
        value: props.value,
        revision: props.revision,
        createdAt: copyInstant(props.createdAt),
        updatedAt: copyInstant(props.updatedAt),
      }),
    );
  }
}
