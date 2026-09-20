import { createHash } from "node:crypto";

import type {
  KnowledgeChunkId,
  KnowledgeChunkLocationV1,
  KnowledgeIndexId,
  WorkspaceId,
} from "@osva/contracts";
import {
  KNOWLEDGE_CHUNK_TEXT_MAX_BYTES,
  KNOWLEDGE_LOCATION_MAX_SERIALIZED_BYTES,
} from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import { copyInstant, requireNonEmptyString } from "./internals.js";

export interface KnowledgeChunkCreateProps {
  readonly id: KnowledgeChunkId;
  readonly workspaceId: WorkspaceId;
  readonly knowledgeIndexId: KnowledgeIndexId;
  readonly ordinal: number;
  readonly text: string;
  readonly location?: KnowledgeChunkLocationV1;
  readonly createdAt: Date;
}

export interface KnowledgeChunkRehydrateProps extends KnowledgeChunkCreateProps {
  readonly textSha256: string;
}

export class KnowledgeChunk {
  readonly id: KnowledgeChunkId;
  readonly workspaceId: WorkspaceId;
  readonly knowledgeIndexId: KnowledgeIndexId;
  readonly ordinal: number;
  readonly text: string;
  readonly textSha256: string;
  readonly location: KnowledgeChunkLocationV1 | undefined;
  readonly createdAt: Date;

  private constructor(props: KnowledgeChunkRehydrateProps) {
    this.id = props.id;
    this.workspaceId = props.workspaceId;
    this.knowledgeIndexId = props.knowledgeIndexId;
    this.ordinal = props.ordinal;
    this.text = props.text;
    this.textSha256 = props.textSha256;
    this.location = props.location;
    this.createdAt = copyInstant(props.createdAt);
  }

  static create(props: KnowledgeChunkCreateProps): KnowledgeChunk {
    if (props.ordinal < 0) {
      throw new DomainInvariantError(
        "Knowledge chunk ordinal must be non-negative.",
      );
    }

    const text = requireNonEmptyString(props.text, "text");
    const textBytes = Buffer.byteLength(text, "utf8");
    if (textBytes > KNOWLEDGE_CHUNK_TEXT_MAX_BYTES) {
      throw new DomainInvariantError("Knowledge chunk text is too large.");
    }

    if (props.location !== undefined) {
      const serialized = JSON.stringify(props.location);
      if (serialized.length > KNOWLEDGE_LOCATION_MAX_SERIALIZED_BYTES) {
        throw new DomainInvariantError(
          "Knowledge chunk location is too large.",
        );
      }
    }

    const digest = `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

    return new KnowledgeChunk({
      ...props,
      text,
      textSha256: digest,
    });
  }

  static rehydrate(props: KnowledgeChunkRehydrateProps): KnowledgeChunk {
    return new KnowledgeChunk(props);
  }
}
