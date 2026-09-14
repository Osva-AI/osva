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

## Required adapter tests

- enqueue/consume;
- redelivery;
- cancellation behavior;
- duplicate tolerance;
- failure handling;
- graceful worker shutdown.
