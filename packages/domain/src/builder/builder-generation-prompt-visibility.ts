import type { BuilderProposalV1 } from "./builder-proposal.js";
import type { BoundedCapabilityCatalogResult } from "./builder-natural-language-prompt.js";
import type { BuilderCatalogIndexV1 } from "./builder-compiler.js";

/**
 * Ensures proposal resource references are only accepted when the model could have selected them
 * from the serialized prompt catalog.
 *
 * When the workspace catalog is truncated for the prompt, ids that still exist in the full catalog
 * but were omitted from the prompt must fail — the model could not have chosen them fairly.
 * Unknown ids (not in the full workspace catalog) defer to compilation
 * (`UNAUTHORIZED_OR_UNKNOWN_RESOURCE_REFERENCE`).
 */
export function validateProposalResourcePromptVisibility(
  proposal: BuilderProposalV1,
  promptCatalog: BoundedCapabilityCatalogResult["promptVisible"],
  fullCatalogIndex: BuilderCatalogIndexV1,
): { ok: true } | { ok: false; message: string } {
  for (const spec of proposal.agents) {
    if (spec.kind === "EXISTING") {
      const id = spec.agentVersionId;
      if (promptCatalog.agentVersionIds.has(id)) {
        continue;
      }
      if (fullCatalogIndex.agentVersionsById.has(id)) {
        return {
          ok: false,
          message: `EXISTING agent references AgentVersionId '${id}' which was not included in the generation prompt catalog.`,
        };
      }
      continue;
    }

    const mpvId = spec.model.modelProfileVersionId;
    if (!promptCatalog.modelProfileVersionIds.has(mpvId)) {
      if (fullCatalogIndex.modelProfileVersionsById.has(mpvId)) {
        return {
          ok: false,
          message: `NEW agent ${spec.ref} uses model profile version '${mpvId}' which was not included in the generation prompt catalog.`,
        };
      }
    }

    for (const t of spec.tools) {
      const tvId = t.toolVersionId;
      if (!promptCatalog.toolVersionIds.has(tvId)) {
        if (fullCatalogIndex.toolVersionsById.has(tvId)) {
          return {
            ok: false,
            message: `NEW agent ${spec.ref} references tool version '${tvId}' which was not included in the generation prompt catalog.`,
          };
        }
      }
    }
  }

  return { ok: true };
}
