import {
  describeDeclarativeManifestValidation,
  isDeclarativeManifest,
  parseManifestRecord,
  readPrimaryModelProfileVersionId,
} from "./declarative-agent-manifest";

export type ManifestAssuranceLevel =
  | "syntax-invalid"
  | "contract-invalid"
  | "draft-valid"
  | "execution-unverified";

export interface ManifestAssuranceView {
  readonly level: ManifestAssuranceLevel;
  readonly title: string;
  readonly detail: string;
}

export function describeManifestAssurance(
  manifestText: string,
): ManifestAssuranceView {
  const parsed = parseManifestRecord(manifestText);
  if (!parsed.ok) {
    return {
      level: "syntax-invalid",
      title: "JSON syntax invalid",
      detail:
        "Fix syntax in Advanced JSON. Guided fields stay read-only until the document parses.",
    };
  }

  const validation = describeDeclarativeManifestValidation(parsed.value);
  if (!validation.ok) {
    return {
      level: "contract-invalid",
      title: "Manifest needs attention",
      detail:
        "The document parses, but required declarative fields or budgets fail local contract validation. Publishing is blocked until corrected.",
    };
  }

  if (
    isDeclarativeManifest(parsed.value) &&
    readPrimaryModelProfileVersionId(parsed.value) === undefined
  ) {
    return {
      level: "contract-invalid",
      title: "Model binding missing",
      detail: "Select a published ModelProfileVersion before publishing.",
    };
  }

  return {
    level: "draft-valid",
    title: "Draft passes local validation",
    detail:
      "This checks JSON syntax and the AgentVersion manifest contract only. It does not invoke a model, tool, or runtime.",
  };
}

export function describeExecutionAssuranceNote(): string {
  return "Successful Runs are the only proof that provider credentials, tools, and runtime configuration work in your workspace.";
}
