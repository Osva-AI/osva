# M22 — Team Chat and unified Inbox (architecture)

**Implementation:** M22.2 and later. M22.0 defines boundaries only — no chat tables or endpoints.

## Goals

- Human-to-human and human-to-worker **requests** in durable threads
- Worker-to-worker **handoffs** tied to real execution events, not simulated chat
- Mentions, replies, links to runs, assignments, approvals, artifacts
- Unified Inbox surfacing messages, approvals, blocked work, and review items

## Reuse-first Inbox design

Prefer **projections** over duplicating authoritative state:

| Inbox signal | Authoritative source | Inbox role |
| --- | --- | --- |
| Approval pending | `ApprovalRequest` + workflow wait state | Notification + deep link |
| Assignment blocked / failed | `Assignment` + `Run` / `WorkflowRun` status | Action item |
| Deliverable ready | `Artifact` + run completion | Review queue |
| Human input required | Workflow wait nodes | Same as approvals |
| @mention / chat message | **New** durable message contract (M22.2) | Conversation |

Do not copy assignment or approval lifecycle into `InboxItem` as a second source of truth.

## Proposed persisted contracts (M22.2)

| Entity | Purpose |
| --- | --- |
| `OfficeThread` | Channel or mission-scoped conversation; workspace + membership ACL |
| `OfficeMessage` | Immutable message body, author (human or worker id), thread id, ordering key |
| `InboxReadState` | Per-principal cursor over inbox feed (not lifecycle) |

`InboxItem` may exist as a **materialized feed row** (type + reference ids + sort key) rebuilt from events, similar to observability projections.

## Security and durability

1. **Workspace isolation** — thread membership ⊆ workspace human members + registered office workers.
2. **Authorship** — human sessions and API keys use existing principals; worker-authored messages only from execution audit pipelines.
3. **Ordering** — monotonic sequence per thread (DB or append log); paginate by cursor.
4. **Untrusted content** — treat all message bodies as prompt-injection surface; workers invoked only via bounded launch with policy checks.
5. **Worker invocation** — a message alone does not start a run; an explicit **work request** API converts to `Assignment` launch or approved automation.
6. **Retention** — align with workspace audit policy; soft-delete threads, hard-retain security events.

## Notifications (deferred)

M22.2 may use polling (TanStack Query refetch) first. WebSocket or SSE only after product proof — see Console integration doc.

## Explicit non-goals (M22.0)

- No autonomous “worker wakes on message” loops
- No fake worker-to-worker chat without `Run` / handoff records
- No separate message broker
