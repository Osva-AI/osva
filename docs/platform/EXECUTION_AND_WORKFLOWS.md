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

Slice 2.2 limitations: no approvals, pause/resume, cancellation, workflow
retries, loops, expression languages, TOOL/HTTP/MCP nodes, or a visual
builder.

## OSS 1.0
OSVA adds stable Workflow Definition v1, durable backend adapters, waits, and stronger recovery.

## Multi-agent
Multi-agent behavior is normal Workflow composition.

## Idempotency
Logical side-effect keys remain stable across retries.
