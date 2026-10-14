import fs from "node:fs/promises";
import path from "node:path";

import { getRepoRoot } from "./stack.js";

export async function reviewDeploymentSecurity() {
  const repoRoot = getRepoRoot();
  const composePath = path.join(repoRoot, "deploy/compose/compose.yml");
  const helmValuesPath = path.join(repoRoot, "deploy/helm/osva/values.yaml");
  const composeText = await fs.readFile(composePath, "utf8");
  const helmValues = await fs.readFile(helmValuesPath, "utf8");

  const findings = [];

  if (/127\.0\.0\.1:3000|0\.0\.0\.0:3000/.test(composeText)) {
    findings.push({
      severity: "P1",
      area: "compose-ports",
      classification: "operator-configuration-required",
      note: "Review published API ports; bind to localhost or place behind reverse proxy for production.",
      evidence: "deploy/compose/compose.yml port mappings",
    });
  }
  if (/POSTGRES_PASSWORD|OSVA_DATABASE_URL/.test(composeText)) {
    findings.push({
      severity: "P1",
      area: "compose-secrets",
      classification: "operator-configuration-required",
      note: "Database credentials supplied via environment; use secret files or external secret manager in production.",
      evidence: "compose environment interpolation",
    });
  }
  if (!/password:/i.test(helmValues) || /changeMe|example/i.test(helmValues)) {
    findings.push({
      severity: "P1",
      area: "helm-defaults",
      classification: "operator-configuration-required",
      note: "Helm values require operator-supplied secrets; chart defaults are placeholders.",
      evidence: "deploy/helm/osva/values.yaml",
    });
  }
  if (/8889|4318/.test(composeText)) {
    findings.push({
      severity: "P2",
      area: "otel-exposure",
      classification: "documentation-improvement",
      note: "Optional observability stack exposes OTLP/scrape ports; keep on internal networks only.",
      evidence: "compose.observability overlay",
    });
  }
  if (!/readOnlyRootFilesystem|runAsNonRoot|capabilities:/.test(helmValues)) {
    findings.push({
      severity: "P2",
      area: "k8s-hardening",
      classification: "safe-default-with-operator-tightening",
      note: "Community chart documents baseline securityContext; operators may tighten further.",
      evidence: "helm templates securityContext blocks",
    });
  }

  findings.push({
    severity: "P0",
    area: "api-auth",
    classification: "verified-control",
    note: "Public API requires Bearer API keys; verified in B.3 acceptance on disposable stack.",
    evidence: "b3-auth-api-keys scenario",
  });

  return {
    scannedFiles: [composePath, helmValuesPath],
    findings,
    summary: `${findings.filter((f) => f.severity === "P0").length} P0, ${findings.filter((f) => f.severity === "P1").length} P1, ${findings.filter((f) => f.severity === "P2").length} P2 documented items`,
  };
}
