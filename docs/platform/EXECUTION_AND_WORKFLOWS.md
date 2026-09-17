# Execution and Workflows

Job dispatch and durable orchestration are separate concerns.

## Stage 1
BullMQ implements JobQueue.

## Stage 2
OSVA adds versioned Workflow execution. PostgreSQL owns WorkflowRun
lifecycle. Child AGENT nodes execute through canonical Run and RunAttempt.
BRANCH, PARALLEL, and JOIN are OSVA orchestration nodes. BullMQ may transport
child work but is not the workflow state machine.

Slice 2.1 executes linear AGENT graphs. Slice 2.2 adds durable DAG
reconciliation: explicit PARALLEL fan-out, JOIN fan-in, deterministic BRANCH
routing, SKIPPED skip propagation, and concurrent ready AGENT nodes.
Slice 2.3 adds multi-agent composition through those same DAG nodes plus a
durable APPROVAL gate. Human approval is workflow state
(`WAITING_FOR_APPROVAL` / `ApprovalRequest`), not a queue job and not
tool-call authorization.

Slice 2.3 limitations: no approval expiration, assignment, quorum, rejection
branches, revision loops, pause/resume outside waiting-for-approval
derivation, cancellation, workflow retries, loops, expression languages,
TOOL/HTTP/MCP nodes, or a visual builder.

Slice 2.4 keeps workflows runtime-agnostic. AGENT nodes still bind immutable
AgentVersion IDs. Trusted TypeScript and Remote HTTP share the same
WorkflowNodeRun → Run → RunAttempt path.


## OSS 1.0
OSVA adds stable Workflow Definition v1, durable backend adapters, waits, and stronger recovery.

## Multi-agent
Multi-agent behavior is normal Workflow composition. An agent cannot
directly create another agent execution. Cross-agent execution is created
only by workflow orchestration.

## Idempotency
Logical side-effect keys remain stable across retries.
