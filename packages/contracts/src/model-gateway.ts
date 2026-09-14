import type { ModelProfileVersionId } from "./ids.js";
import type { JsonSchemaRecord } from "./json-schema.js";

export interface ModelToolDefinition {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JsonSchemaRecord;
}

export interface ModelRequest {
  readonly modelProfileVersionId: ModelProfileVersionId;
  readonly instructions: string;
  readonly input: unknown;
  readonly structuredOutputSchema?: JsonSchemaRecord;
  readonly toolDefinitions?: readonly ModelToolDefinition[];
  readonly timeoutMs: number;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ModelUsage {
  readonly inputUnits: number;
  readonly outputUnits: number;
  readonly cachedUnits?: number;
}

export interface ModelResponse {
  readonly provider: string;
  readonly model: string;
  readonly providerResponseId?: string;
  readonly output: unknown;
  readonly usage: ModelUsage;
  readonly estimatedCost?: number;
  readonly latencyMs: number;
}

/**
 * Provider SDK types must not escape the adapter that implements this port.
 */
export interface ModelGateway {
  invoke(request: ModelRequest): Promise<ModelResponse>;
}
