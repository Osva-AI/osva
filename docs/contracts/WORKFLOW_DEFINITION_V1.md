# Workflow Definition v1

**Status:** Pre-1.0 contract

## Structure

```yaml
schemaVersion: "1"
key: research-report
name: Research Report

nodes:
  - id: research
    type: agent
    agentRef: research-agent

  - id: approval
    type: approval
    dependsOn: [research]

  - id: publish
    type: agent
    agentRef: publishing-agent
    dependsOn: [approval]
```

## Node types

Initial conceptual types:

- agent
- tool
- rule
- branch
- parallel
- wait
- approval
- human_task
- subworkflow

## Versioning

Every executable Workflow references one immutable WorkflowVersion.

## Execution bindings

Logical references resolve to immutable effective versions.

Static references resolve at WorkflowRun planning time.

Dynamic references resolve once when the node first becomes runnable.

Retries reuse bindings.
