# M22 — Team Chat and unified Inbox (architecture)

**M22.2A (backend):** durable threads, human messages, read state, and inbox projection are implemented. **M22.2B (Console):** Chat and Inbox UI — planned.

## Goals

- Human-to-human and human-to-worker **requests** in durable threads
- Worker-to-worker **handoffs** tied to real execution events, not simulated chat
- Mentions, replies, links to runs, assignments, approvals, artifacts
- Unified Inbox surfacing messages, approvals, blocked work, and review items

## Reuse-first Inbox design

Prefer **projections** over duplicating authoritative state:

| Inbox signal | Authoritative source | Inbox role |
| --- | --- | --- |
| Approval pending | `ApprovalRequest` + workflow wait state | Notification + deep link (**deferred** in M22.2A — no per-user recipient model) |
| Assignment blocked / failed | `Assignment` + `Run` / `WorkflowRun` status | Action item (**deferred** in M22.2A) |
| Deliverable ready | `Artifact` + run completion | Review queue (**deferred**) |
| Human input required | Workflow wait nodes | Same as approvals (**deferred**) |
| @mention / chat message | `OfficeMessage` (M22.2A) | Conversation |

Do not copy assignment or approval lifecycle into `InboxItem` as a second source of truth.

## Persisted contracts (M22.2A)

| Entity | Purpose |
| --- | --- |
| `OfficeThread` | Workspace-scoped conversation; optional `teamId` / `goalId` **context only** |
| `OfficeMessage` | Immutable body; human authorship from session; monotonic `sequence` per thread |
| `InboxReadState` | Per-user `lastReadSequence` per thread (read ≠ resolved) |

`InboxItem` is a **derived feed** (`CHAT_MESSAGE`, `CHAT_MENTION`) built from messages + personal read state.

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
6. **Inbox scope (M22.2A)** — chat messages and @mentions only; approvals, assignments, and deliverables remain deferred

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

- Chat/Inbox frontend, worker auto-reply, separate message broker, approval/assignment inbox projection
