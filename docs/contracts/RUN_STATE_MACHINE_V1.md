# Run State Machine v1

## Run states

```text
PENDING
QUEUED
RUNNING
SUCCEEDED
FAILED
TIMED_OUT
CANCELLED
```

Terminal:

```text
SUCCEEDED
FAILED
TIMED_OUT
CANCELLED
```

## Normal path

```text
PENDING → QUEUED → RUNNING → SUCCEEDED
```

## Failure paths

```text
PENDING → FAILED
QUEUED → CANCELLED
RUNNING → FAILED
RUNNING → TIMED_OUT
RUNNING → CANCELLED
```

Terminal Runs cannot reopen.

## Attempts

A Run may have multiple RunAttempts.

Each attempt records:

- sequence;
- status;
- started/completed timestamps;
- infrastructure metadata;
- error;
- JSON-compatible `output` after success.

Output is absent until the attempt succeeds. Once terminal, output is
immutable. Queue redelivery must not overwrite it.

Queue redelivery of the same attempt does not create another RunAttempt.

## Steps

RunSteps belong to one RunAttempt and retain parent Run identity.
