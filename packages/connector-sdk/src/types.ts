import type { JsonSchemaRecord } from "@osva/contracts";

export interface ConnectorMetadata {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly version: string;
}

export interface ConnectorToolContext {
  readonly signal?: AbortSignal;
  readonly log?: ConnectorLogger;
}

export interface ConnectorLogger {
  info(
    message: string,
    fields?: Record<string, string | number | boolean>,
  ): void;
  warn(
    message: string,
    fields?: Record<string, string | number | boolean>,
  ): void;
  error(
    message: string,
    fields?: Record<string, string | number | boolean>,
  ): void;
}

export type ConnectorToolHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  context: ConnectorToolContext,
) => Promise<TOutput> | TOutput;

export interface DefinedConnectorTool<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaRecord;
  readonly handler: ConnectorToolHandler<TInput, TOutput>;
}

export interface DefinedConnector {
  readonly metadata: ConnectorMetadata;
  readonly tools: readonly DefinedConnectorTool[];
}
