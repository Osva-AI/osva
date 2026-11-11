import type { DoctorCheck } from "../doctor/types.js";
import { REQUIRED_NODE_MAJOR } from "../doctor/run-doctor.js";

export type PrerequisiteKind =
  "REQUIRED" | "OPTIONAL" | "MANAGED_BY_OSVA" | "NOT_APPLICABLE";

export interface PrerequisiteDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: PrerequisiteKind;
  readonly requirement: string;
}

export const SETUP_PREREQUISITES: readonly PrerequisiteDefinition[] = [
  {
    id: "node",
    label: "Node.js",
    kind: "REQUIRED",
    requirement: `>= ${String(REQUIRED_NODE_MAJOR)} for the published OSVA CLI.`,
  },
  {
    id: "docker_engine",
    label: "Docker Engine",
    kind: "REQUIRED",
    requirement:
      "Docker Engine or Docker Desktop for standard Compose install.",
  },
  {
    id: "docker_compose",
    label: "Docker Compose V2",
    kind: "REQUIRED",
    requirement: "Compose V2 plugin (`docker compose`).",
  },
  {
    id: "postgresql",
    label: "PostgreSQL",
    kind: "MANAGED_BY_OSVA",
    requirement: "Provisioned in the OSVA Compose stack.",
  },
  {
    id: "valkey",
    label: "Valkey",
    kind: "MANAGED_BY_OSVA",
    requirement: "Provisioned in the OSVA Compose stack.",
  },
  {
    id: "pnpm",
    label: "pnpm",
    kind: "NOT_APPLICABLE",
    requirement: "Not required for published npm CLI installation.",
  },
  {
    id: "python",
    label: "Python",
    kind: "OPTIONAL",
    requirement:
      "Optional unless using Python remote runtimes or development tooling.",
  },
];

export function prerequisiteCatalogCheck(): DoctorCheck {
  const required = SETUP_PREREQUISITES.filter(
    (entry) => entry.kind === "REQUIRED",
  )
    .map((entry) => entry.label)
    .join(", ");
  return {
    id: "prerequisite_catalog",
    status: "PASS",
    message: `Community setup requires: ${required}. PostgreSQL and Valkey are provisioned by OSVA.`,
  };
}
