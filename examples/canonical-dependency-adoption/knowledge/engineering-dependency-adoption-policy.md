# Engineering Dependency Adoption Policy

**ExampleCo internal engineering policy (fictional).** This document exists solely to exercise knowledge retrieval in the canonical OSVA dependency-adoption example. It is not an OSVA product policy.

## Purpose

This policy defines how ExampleCo engineering teams evaluate third-party open-source dependencies before adding them to production services. The goal is consistent risk assessment across teams, not blanket approval or rejection based on popularity alone.

## Evaluation principles

1. **Evidence over intuition.** Recommendations must cite policy criteria and observable package metadata.
2. **Use-case fit.** A package suitable for a CLI prototype may be unacceptable for a regulated data path.
3. **Proportionality.** Low-risk dev tooling may pilot with lighter scrutiny; customer-facing or privileged paths require stricter bars.
4. **Honest uncertainty.** Missing license, stale maintenance, or conflicting signals should yield **NEEDS_REVIEW**, not fabricated certainty.
5. **Human approval for material adoption.** Any **ADOPT** or **PILOT** in a tier-1 service requires engineering manager approval in the workflow (outside this document).

## License requirements

- **Preferred:** MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, ISC.
- **Review required:** LGPL (any version), MPL-2.0, dual-licensed packages, or any license not on the preferred list.
- **Do not adopt without legal review:** AGPL-3.0, SSPL, Commons Clause, or **unknown / missing** license fields in registry metadata.
- License compatibility must be assessed against ExampleCo’s distribution model (SaaS, on-prem artifacts, mobile embeds).

## Maintenance and release health

- **Healthy:** meaningful commits or releases within the last 12 months for actively used ecosystems; responsive issue triage for popular packages.
- **Elevated risk:** no release in 18+ months while ecosystem majors have moved; single maintainer with no bus-factor mitigation for critical paths.
- **High risk / likely DO_NOT_ADOPT:** officially deprecated packages, archived repositories, or maintainer advisories to migrate.
- Recent maintenance is **necessary but not sufficient**—a actively patched package with a bad license remains unacceptable.

## Community adoption

- Download counts and GitHub stars are **supporting** signals only.
- Compare adoption to peers in the same category (validation libraries, HTTP clients, etc.).
- Very low download counts (< ~1k weekly) for generic utilities warrant **PILOT** or **NEEDS_REVIEW**, not automatic rejection, unless combined with maintenance or security red flags.
- Sudden download spikes without repository activity may indicate typosquatting—investigate provenance.

## Security expectations

- Prefer packages with published security policy or active CVE response history.
- Transitive dependency count and native addon requirements increase audit cost—factor into **PILOT** scope limits.
- Packages with history of critical CVEs without timely patches require **NEEDS_REVIEW** at minimum.
- Do not treat “no known CVEs” as proof of safety when maintenance is absent.

## Dependency complexity

- Avoid adding overlapping libraries when an approved alternative already exists in the service’s stack.
- Wrappers that hide critical behavior (crypto, auth, serialization) require architecture review.
- Heavy native bindings may block certain deployment targets—call out operational constraints explicitly.

## Operational considerations

- Evaluate bundle size, runtime memory, and cold-start impact for edge and serverless targets.
- Confirm observability hooks or failure modes align with ExampleCo SLO practices.
- For data-processing dependencies, document PII handling and logging side effects.

## Decision categories

### ADOPT

Use when **all** of the following hold:

- License is on the preferred list (or legal has explicitly approved otherwise).
- Maintenance is healthy for the intended use case tier.
- Security and operational risks are acceptable without heroic mitigations.
- A clear owner team accepts upgrade and incident responsibility.

### PILOT

Use when the package shows promise but evidence is incomplete or risk is bounded:

- Limited production scope (feature flag, non-critical path, internal tool).
- License or maintenance signals are mixed but not disqualifying.
- Additional time-boxed evaluation will resolve open questions.

Pilots must define success metrics and a rollback plan.

### DO_NOT_ADOPT

Use when disqualifying factors dominate:

- Incompatible or unknown license for the deployment model.
- Deprecated or abandoned package with no credible successor path inside the use case.
- Unacceptable security posture for the tier (e.g., repeated critical CVEs, unmaintained crypto).
- Duplicates an approved dependency without compelling justification.

### NEEDS_REVIEW

Use when:

- License field is missing or ambiguous in public metadata.
- Maintenance and community signals conflict.
- Use case constraints (from the request) cannot be mapped to criteria with available evidence.
- External npm metadata and internal policy chunks disagree materially.

Analysts must list **openQuestions** rather than defaulting to ADOPT.

## Human approval requirements

- Workflow **APPROVAL** is mandatory after Analysis and before report generation for this process.
- Approvers verify disposition, confidence, cited criteria, and listed risks—not raw download counts alone.
- Approvers may reject and request re-analysis; they must not substitute an unreviewed ADOPT decision.

## Appendix: illustrative criterion labels

Teams may map analysis `criteria` entries to labels such as:

- `license-compatibility`
- `maintenance-health`
- `security-posture`
- `community-adoption`
- `operational-fit`
- `dependency-complexity`
- `use-case-alignment`

These labels are guidance for agents and humans; they are not a scoring formula and must not be applied as a rigid checklist that ignores context.
