import type {
  InternalToolImplementationId,
  McpToolVersionConfig,
  ToolId,
  ToolType,
  ToolVersionId,
} from "@osva/contracts";
import {
  isInternalToolImplementationId,
  isToolType,
  MCP_TOOL_IMPLEMENTATION,
} from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import {
  copyInstant,
  deepFreeze,
  requireNonEmptyString,
  requirePositiveInteger,
} from "./internals.js";

export interface ToolVersionProps {
  readonly id: ToolVersionId;
  readonly toolId: ToolId;
  readonly version: number;
  readonly type: ToolType;
  readonly implementation:
    InternalToolImplementationId | typeof MCP_TOOL_IMPLEMENTATION;
  readonly mcp?: McpToolVersionConfig;
  readonly createdAt: Date;
}

export class ToolVersion {
  readonly id: ToolVersionId;
  readonly toolId: ToolId;
  readonly version: number;
  readonly type: ToolType;
  readonly implementation:
    InternalToolImplementationId | typeof MCP_TOOL_IMPLEMENTATION;
  readonly mcp: McpToolVersionConfig | undefined;
  readonly createdAt: Date;

  private constructor(props: ToolVersionProps) {
    this.id = props.id;
    this.toolId = props.toolId;
    this.version = props.version;
    this.type = props.type;
    this.implementation = props.implementation;
    this.mcp = props.mcp;
    this.createdAt = props.createdAt;
  }

  static create(props: ToolVersionProps): ToolVersion {
    if (!props.id) {
      throw new DomainInvariantError("ToolVersion.id is required.");
    }

    if (!props.toolId) {
      throw new DomainInvariantError("ToolVersion.toolId is required.");
    }

    if (!isToolType(props.type)) {
      throw new DomainInvariantError(
        "ToolVersion.type must be a supported tool type.",
      );
    }

    if (props.type === "INTERNAL") {
      if (!isInternalToolImplementationId(props.implementation)) {
        throw new DomainInvariantError(
          "ToolVersion.implementation must be a known internal implementation.",
        );
      }

      if (props.mcp !== undefined) {
        throw new DomainInvariantError(
          "ToolVersion.mcp must not be set for INTERNAL tools.",
        );
      }
    } else {
      if (props.implementation !== MCP_TOOL_IMPLEMENTATION) {
        throw new DomainInvariantError(
          "ToolVersion.implementation must be MCP_V1 for MCP tools.",
        );
      }

      if (props.mcp === undefined) {
        throw new DomainInvariantError(
          "ToolVersion.mcp is required for MCP tools.",
        );
      }
    }

    return Object.freeze(
      new ToolVersion({
        id: props.id,
        toolId: props.toolId,
        version: requirePositiveInteger(props.version, "ToolVersion.version"),
        type: props.type,
        implementation: requireNonEmptyString(
          props.implementation,
          "ToolVersion.implementation",
        ) as InternalToolImplementationId | typeof MCP_TOOL_IMPLEMENTATION,
        mcp: props.mcp === undefined ? undefined : deepFreeze(props.mcp),
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }
}

export function isSameMcpToolVersionConfig(
  left: McpToolVersionConfig,
  right: McpToolVersionConfig,
): boolean {
  return (
    left.connectorVersionId === right.connectorVersionId &&
    left.remoteToolName === right.remoteToolName &&
    left.description === right.description &&
    JSON.stringify(left.inputSchema) === JSON.stringify(right.inputSchema)
  );
}
