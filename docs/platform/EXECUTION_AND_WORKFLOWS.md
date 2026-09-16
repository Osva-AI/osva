# Execution and Workflows

Job dispatch and durable orchestration are separate concerns.

## Stage 1
BullMQ implements JobQueue.

## Stage 2
OSVA adds versioned sequential Workflow execution. PostgreSQL owns WorkflowRun
lifecycle. Child AGENT nodes execute through canonical Run and RunAttempt.
BullMQ may transport child work but is not the workflow state machine.

Slice 2.1 limitations: linear AGENT graphs only; no branches, parallel
execution, approvals, expression languages, or workflow-level retries.

## OSS 1.0
OSVA adds stable Workflow Definition v1, durable backend adapters, waits, and stronger recovery.

## Multi-agent
Multi-agent behavior is normal Workflow composition.

## Idempotency
Logical side-effect keys remain stable across retries.
