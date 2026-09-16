# Workflow Definition v1

**Status:** Pre-1.0 contract

Slice 2.1 persists graph-shaped WorkflowVersion definitions. Only a
deterministic linear AGENT chain is executable. Later slices can relax
validation without changing the nodes-plus-edges storage shape.

## Stage 2.1 stored shape

```json
{
  "schemaVersion": "1",
  "nodes": [
    {
      "key": "research",
      "type": "AGENT",
      "agentVersionId": "agent-version-1"
    },
    {
      "key": "summarize",
      "type": "AGENT",
      "agentVersionId": "agent-version-2"
    }
  ],
  "edges": [
    {
      "from": "research",
      "to": "summarize"
    }
  ]
}
```

AGENT nodes bind an immutable `agentVersionId`. Logical aliases such as
`latest`, `active`, and `current` are not supported. Definitions do not bind
merely to `agentId`.

Slice 2.1 validation requires:

- unique node keys
- edges that reference existing nodes
- referenced AgentVersions that exist in the same workspace
- exactly one entry node and one terminal node
- no cycles, branches, fan-in, or disconnected nodes
- at most one incoming edge and one outgoing edge per node
- every node on the single linear chain

A single-node workflow is valid.

## Conceptual node types

Later slices may introduce additional node types. They are not executable in
Slice 2.1:

- AGENT
- TOOL
- RULE
- BRANCH
- PARALLEL
- WAIT
- APPROVAL
- HUMAN_TASK
- SUBWORKFLOW

Slice 2.2 executes BRANCH, PARALLEL, and JOIN on `schemaVersion: "2"`
definitions. See [`WORKFLOW_DEFINITION_V2.md`](WORKFLOW_DEFINITION_V2.md).
V1 sequential AGENT graphs remain valid and executable without semantic
changes.

## Versioning

Every executable WorkflowRun references one immutable WorkflowVersion.
Execution never resolves a "latest" workflow version.

## Execution bindings

Workflow definitions reference immutable AgentVersions. Child Agent Runs freeze
their own effective bindings through the existing CreateRun path. Retries of a
child Run reuse those bindings.
