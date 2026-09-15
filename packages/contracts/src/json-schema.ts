/**
 * JSON Schema-like document stored on manifests and tool versions.
 * Stage 0 treats this as an opaque record; AJV validation is out of scope.
 */
export type JsonSchemaRecord = Record<string, unknown>;
