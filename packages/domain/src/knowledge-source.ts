import type {
  ArtifactId,
  JsonObject,
  KnowledgeSourceId,
  WorkspaceId,
} from "@osva/contracts";
import { KNOWLEDGE_ATTRIBUTES_MAX_SERIALIZED_BYTES } from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";
import { validateKnowledgeFlatAttributes } from "./knowledge-attributes.js";

export interface KnowledgeSourceCreateProps {
  readonly id: KnowledgeSourceId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly artifactId: ArtifactId;
  readonly attributes?: JsonObject;
  readonly idempotencyKey?: string;
  readonly createdAt: Date;
}

export interface KnowledgeSourceRehydrateProps extends KnowledgeSourceCreateProps {
  readonly attributes: JsonObject;
}

export class KnowledgeSource {
  readonly id: KnowledgeSourceId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly artifactId: ArtifactId;
  readonly attributes: JsonObject;
  readonly idempotencyKey: string | undefined;
  readonly createdAt: Date;

  private constructor(props: KnowledgeSourceRehydrateProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.key = props.key;
    this.name = props.name;
    this.artifactId = props.artifactId;
    this.attributes = props.attributes;
    this.idempotencyKey = props.idempotencyKey;
    this.createdAt = copyInstant(props.createdAt);
  }

  static create(props: KnowledgeSourceCreateProps): KnowledgeSource {
    const attributes = validateKnowledgeFlatAttributes(props.attributes ?? {});
    const serialized = JSON.stringify(attributes);
    if (serialized.length > KNOWLEDGE_ATTRIBUTES_MAX_SERIALIZED_BYTES) {
      throw new DomainInvariantError(
        "Knowledge source attributes are too large.",
      );
    }

    return new KnowledgeSource({
      ...props,
      key: requireNonEmptyString(props.key, "key"),
      name: requireNonEmptyString(props.name, "name"),
      attributes,
    });
  }

  static rehydrate(props: KnowledgeSourceRehydrateProps): KnowledgeSource {
    return new KnowledgeSource(props);
  }
}
