import type {
  InternalToolImplementationId,
  ToolEffectClassification,
} from "@osva/contracts";

export interface InternalToolCatalogEntry {
  readonly id: InternalToolImplementationId;
  readonly effect: ToolEffectClassification;
}

export const INTERNAL_TOOL_CATALOG: Readonly<
  Record<InternalToolImplementationId, InternalToolCatalogEntry>
> = Object.freeze({
  OSVA_ECHO_V1: Object.freeze({
    id: "OSVA_ECHO_V1",
    effect: "READ_ONLY",
  }),
  OSVA_CLOCK_NOW_V1: Object.freeze({
    id: "OSVA_CLOCK_NOW_V1",
    effect: "READ_ONLY",
  }),
});

export function getInternalToolCatalogEntry(
  implementation: InternalToolImplementationId,
): InternalToolCatalogEntry | undefined {
  return INTERNAL_TOOL_CATALOG[implementation];
}
