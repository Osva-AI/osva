# Execution and Workflows

Job dispatch and durable orchestration are separate concerns.

## Stage 1
BullMQ implements JobQueue.

## Stage 2
OSVA adds versioned Workflow execution.

## OSS 1.0
OSVA adds stable Workflow Definition v1, durable backend adapters, waits, and stronger recovery.

## Multi-agent
Multi-agent behavior is normal Workflow composition.

## Idempotency
Logical side-effect keys remain stable across retries.
