# Telemetry Contract

## Canonical entities

OSVA owns:

- Run
- RunAttempt
- RunStep
- RunLog
- UsageRecord
- EvaluationResult

## TelemetrySink

External exporters receive normalized events/spans.

## Correlation fields

Where applicable:

```text
workspaceId
agentId
agentVersionId
workflowRunId
runId
runAttemptId
runStepId
```

## Rules

- telemetry exporters do not become canonical storage;
- secret values are redacted;
- dropping external telemetry must not destroy Run state.
