# M22 — Console integration readiness

M22.0 does not ship Virtual Office UI. This map guides M22.1 and M22.2.

## Existing Console patterns to reuse

| Pattern | Location | Reuse for Virtual Office |
| --- | --- | --- |
| Human session + workspace pin | `apps/console` auth routes, session cookies | Same session for Office routes |
| BFF proxy to OSVA | `apps/console/src/server` → `osva-client.ts` | Add `/api/v1/office/*` passthrough entries in M22.1 |
| TanStack Query hooks | `apps/console/src/client/hooks/*` | `useOfficeWorkers`, `useTeams`, `useAssignments` |
| Route layout + nav | React Router in `apps/console/src/client/routes` | New `/office` section, not a second app |
| Design tokens / states | Existing list/detail pages | Loading, empty, permission-denied parity |
| Examples catalog | `osva-examples-catalog.ts` | Link founders-office-worker example |

## Future routes (M22.1+)

```text
/office                     Mission Control shell
/office/teams               Team list / detail
/office/workers             Worker registry
/office/missions            Goals
/office/assignments         Task board
/office/chat/:threadId      M22.2
/office/inbox               M22.2
```

## BFF policy (later)

1. Extend allowlists in Console server proxy (same pattern as `/api/v1/agents`).
2. Forward `Authorization` / session-derived OSVA credentials only — no new auth plane.
3. EXECUTE-gated routes (`assignments/launch`, `cancel`) require operator role in UI before mutation.

## Live updates

Default: **polling** with conservative `staleTime` and mutation invalidation. No WebSocket infrastructure in M22.0–M22.1 unless latency requirements are documented.

## Accessibility and layout

- Reuse Console responsive shell (sidebar + main).
- Keyboard-navigable lists; thread view must support screen-reader landmarks in M22.2.
- Do not fork styling — extend existing token set.

## M22.1 blockers (none from M22.0 foundation)

Office REST and SDK paths are aligned; security matrix covers assignments. Console work is additive BFF + UI only.
