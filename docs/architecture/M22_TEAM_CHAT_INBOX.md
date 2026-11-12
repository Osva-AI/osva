# M22 — Team Chat and unified Inbox (architecture)

**M22.2A (backend):** durable threads, human messages, and thread-scoped read state. **M22.2B (Console):** Chat and Inbox UI. **M22.2C:** unified inbox projections for approvals, assignments, and deliverables (this document).

## Goals

- Human-to-human and human-to-worker **requests** in durable threads
- Worker-to-worker **handoffs** tied to real execution events, not simulated chat
- Mentions, replies, links to runs, assignments, approvals, artifacts
- Unified Inbox surfacing messages, approvals, blocked work, and review items

## Reuse-first Inbox design

Prefer **projections** over duplicating authoritative state:

| Inbox signal | Authoritative source | Inbox role |
| --- | --- | --- |
| Approval pending | `ApprovalRequest` (`PENDING`) | Inbox item for every workspace human with Office `READ`; decide via existing approval API (`EXECUTE`) |
| Assignment failed / cancelled | `Assignment` terminal `FAILED` / `CANCELLED` | Inbox item per workspace human until user-acknowledged |
| Deliverable ready | `Artifact.producerRunId` = completed `Assignment.runId` | Inbox item until user-acknowledged (agent-version assignments only in M22.2C) |
| Human input required | Workflow wait nodes | Surfaced as `APPROVAL_PENDING` when an `ApprovalRequest` exists |
| @mention / chat message | `OfficeMessage` | Conversation (thread read state unchanged) |

Do not copy assignment or approval lifecycle into `InboxItem` as a second source of truth.

## Persisted contracts (M22.2A)

| Entity | Purpose |
| --- | --- |
| `OfficeThread` | Workspace-scoped conversation; optional `teamId` / `goalId` **context only** |
| `OfficeMessage` | Immutable body; human authorship from session; monotonic `sequence` per thread |
| `InboxReadState` | Per-user `lastReadSequence` per thread (read ≠ resolved) |
| `InboxItemReadState` | Per-user acknowledgement of operational inbox item ids (`approval:*`, `assignment:*`, `deliverable:*`) |

`InboxItem` is a **derived feed** built at read time. Kinds: `CHAT_MESSAGE`, `CHAT_MENTION`, `APPROVAL_PENDING`, `ASSIGNMENT_UPDATE`, `DELIVERABLE_READY`. Stable ids: `chat:{messageId}`, `approval:{approvalRequestId}`, `assignment:{assignmentId}:{status}`, `deliverable:{artifactId}`.

## Visibility and authorization (v1)

| Topic | M22.2A behavior |
| --- | --- |
| Thread visibility | **Workspace-wide** — any workspace human with Office `READ` can list/read threads |
| Team / goal context | Optional metadata; **does not** restrict access (worker `TeamMembership` is unrelated) |
| Create thread / post | Human session + Office `WRITE` |
| List threads / messages | Human session or API key + Office `READ` (API keys see **all** workspace threads — same visibility as humans) |
| Inbox / read state | **Human session only** + Office `READ` / `WRITE` |
| Worker-authored messages | **Not exposed** — no public worker impersonation endpoint |
| Mentions | Stored and validated; **do not** launch runs or consume model tokens |

## Ordering and pagination

- Per-thread monotonic `sequence` assigned under row lock on append
- Message list: ascending `sequence` cursor
- Thread list: `updatedAt` desc cursor
- Inbox: `occurredAt` desc cursor over unread projected items

## Security and durability

1. **Workspace isolation** — all repository lookups are workspace-scoped
2. **Authorship** — `authorUserId` from human session only; API keys cannot post as humans
3. **Untrusted content** — message bodies are data; mentions are not execution requests
4. **Worker invocation** — messages alone do not start runs
5. **Idempotency** — optional `idempotencyKey` per thread message POST; first successful write wins, safe retries return the stored message (conflicting bodies are not merged)
6. **Inbox scope (M22.2C)** — chat plus operational projections; listing inbox never enqueues execution

## REST (canonical)

- `GET/POST /v1/office/threads`
- `GET /v1/office/threads/:threadId`
- `GET/POST /v1/office/threads/:threadId/messages`
- `GET /v1/office/inbox`
- `PATCH /v1/office/inbox/read-state`

## M22.2B Console readiness

- Routes: `/office/chat`, `/office/chat/:threadId`, `/office/inbox`
- BFF allowlist entries for the routes above (not added in M22.2A)
- TanStack Query polling; safe markdown rendering for message bodies

## Notifications (deferred)

Polling first. No WebSocket/SSE in M22.2A.

## Explicit non-goals (M22.2A)

- Worker auto-reply, separate message broker, workflow-assignment deliverable join (no reliable single-run artifact link), M22.3 task board UX
