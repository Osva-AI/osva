# ADR-011: Atomic builder publication persistence (M20.4)

## Status

Accepted — M20.4

## Context

M20.1–M20.3 produce and edit `BuilderProposalV1` without creating immutable `AgentVersionId` values. Publication must create multiple registry rows atomically. Existing `appendAgentVersion` / `appendWorkflowVersion` repository methods each commit in isolation.

## Decision

Introduce `PostgresBuilderPublicationRepository.publishAtomically` and a minimal `builder_publications` table for durable idempotency and receipts. Publication orchestration lives in `@osva/domain/builder`; HTTP remains thin.

## Consequences

- New migration `0032_builder_publication_slice`.
- No change to existing append APIs; publication does not call them sequentially for commit.
- Audit event for successful publication is written in the same transaction as product rows.
