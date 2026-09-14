# AI Office Vision

AI Office is an application layer over OSVA.

It models responsibility and organization, not runtime infrastructure.

## Entities

```text
Office
Team
Role
OfficeWorker
Goal
Assignment
HumanTask
```

## OfficeWorker

An OfficeWorker references executable capabilities:

- Agents;
- Workflows;
- Tools;
- Knowledge;
- policy/budget context.

## Manager behavior

A manager is an OfficeWorker or Role whose normal Workflows can delegate, review, request rework, escalate, and approve.

There is no separate manager runtime.
