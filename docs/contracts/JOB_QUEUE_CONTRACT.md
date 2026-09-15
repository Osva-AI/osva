# JobQueue Contract

## Purpose

Dispatch OSVA work without exposing queue-engine semantics to domain services.

## Interface capabilities

Conceptually:

```text
enqueue(runAttemptId)
cancel(runAttemptId)
consume(handler)
```

## Delivery

At-least-once delivery must be tolerated.

A queue delivery references a RunAttempt.

Redelivery reuses the same RunAttempt identity.

## Retry ownership

OSVA decides when a new RunAttempt exists.

The queue may redeliver work, but it does not create product attempts itself.

## Payload

Keep payload minimal:

```json
{
  "runAttemptId": "uuid"
}
```

Execution state is loaded from OSVA storage.

## Production adapter (Stage 1.3)

`@osva/adapters-bullmq` is the production `JobQueue`. It stores only
`{ runAttemptId }` on the `osva-execution` queue. BullMQ job IDs are
infrastructure details and are not OSVA identity. `MemoryJobQueue` remains the
in-process test adapter.

## Required adapter tests

- enqueue/consume;
- redelivery;
- cancellation behavior;
- duplicate tolerance;
- failure handling;
- graceful worker shutdown.
