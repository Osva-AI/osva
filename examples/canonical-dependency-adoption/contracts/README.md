# Canonical dependency adoption — example contracts

These JSON Schemas define **example-level** data contracts for the canonical OSS 1.0 dependency-adoption workflow. They are **not** new public OSVA platform contracts.

## Schemas

| File | Role |
| --- | --- |
| `workflow-input.v1.schema.json` | WorkflowRun input: stable request envelope (`requestId`, package, use case, constraints). |
| `research-output.v1.schema.json` | Research Agent output: preserved request plus policy RAG evidence and npm external evidence. **No adoption decision.** |
| `analysis-output.v1.schema.json` | Analysis Agent output: preserved request and research, plus structured recommendation (`disposition`, criteria, risks). |
| `report-output.v1.schema.json` | Report Agent / workflow terminal output: compact summary plus `ArtifactReferenceV1`-compatible artifact pointer. |

## Schema versioning

Each document includes `schemaVersion: "1"`. Breaking changes to example payloads should bump the version and add a new schema file rather than silently mutating v1.

## Request envelope preservation

The request envelope is deliberately preserved through Research and Analysis because Workflow Definition V3 passes **predecessor output** to the next node and the EVENT WAIT resolves correlation from `/request/requestId`.

```text
Workflow input.request
  → Research output.request (unchanged)
  → Analysis output.request (unchanged)
  → APPROVAL input/output (pass-through)
  → WAIT input/output (pass-through)
  → Report input (full Analysis-shaped envelope)
```

Research and Analysis agents must not drop or rename `request` fields. Analysis must keep the full `research` object so downstream human review and reporting retain evidence.

## Why Research does not decide

Research gathers **evidence** (internal policy chunks and public npm metadata). Final disposition belongs to Analysis so humans approve a single structured recommendation, not raw retrieval output.

## Why Analysis preserves Research

Approval and reporting need the same evidence the model used. Truncating research would break auditability and make Report generation re-fetch or hallucinate context.

## Why APPROVAL and WAIT do not mutate the envelope

APPROVAL and EVENT WAIT orchestration nodes pass their input through as output. Their purpose is governance and durable wait/resume, not data transformation.

## Why Report output is compact

The markdown report body lives in an OSVA **Artifact**. WorkflowRun output only carries `requestId`, disposition, summary, and an artifact reference—matching platform `ArtifactReferenceV1` (`type: "artifact"`, `artifactId`).
