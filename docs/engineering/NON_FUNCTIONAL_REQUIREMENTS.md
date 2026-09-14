# Non-Functional Requirements

## Reliability
Retries, timeout, cancellation, duplicate delivery tolerance, worker crash recovery.

## Reproducibility
Immutable effective bindings.

## Scalability
ExecutionWorkers scale independently from control plane.

## Security
Least privilege, no browser secrets, explicit Tool permissions, stronger isolation before untrusted code.

## Observability
Every execution attributable to versions and attempts.

## Cost
Usage and external costs attributable to Runs.

## Portability
Docker Compose first, production deployment later.

## Upgradeability
Schema migrations and contract versions are first-class.
