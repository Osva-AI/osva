# M11 human authentication and Console acceptance summary

Evidence-oriented checklist for M11 Slice 3 closeout. Items are **PASS** only when linked automated coverage exists or a manual step is explicitly recorded.

## Migration and bootstrap

| Item                                         | Status | Evidence                                                                                                      |
| -------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| Migration head `0026_better_auth_user_image` | PASS   | `pnpm db:migrations:verify` (`packages/db` migration history tests)                                           |
| First-admin / identity bootstrap             | PASS   | `apps/web/test/integration/human-identity-slice.integration.test.ts`                                          |
| Setup completion (human)                     | PASS   | `apps/console/test/integration/console-human-session.integration.test.ts` (BFF `/api/v1/auth/setup/complete`) |

## Session and cookies

| Item                                 | Status | Evidence                                                                                                                                                          |
| ------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login via Console BFF                | PASS   | `apps/console/test/integration/console-human-session.integration.test.ts`                                                                                         |
| Session JSON excludes session token  | PASS   | `apps/console/test/integration/console-human-session.integration.test.ts`, `apps/console/test/human-session-bff.test.ts`                                          |
| HttpOnly session cookie via BFF      | PASS   | `apps/console/test/human-session-bff.test.ts` (sanitized `Set-Cookie`)                                                                                            |
| 12-hour idle / 7-day absolute expiry | PASS   | [ADR-008](../adr/ADR-008-human-identity-and-workspace-access.md) + `docs/architecture/HUMAN_AUTHENTICATION.md` (policy); Better Auth adapter config in `apps/web` |
| Logout clears cookie                 | PASS   | `apps/console/test/integration/console-human-session.integration.test.ts`                                                                                         |
| Stale cookie rejected                | PASS   | `apps/console/test/integration/console-human-session.integration.test.ts`                                                                                         |

## Workspaces

| Item                                  | Status | Evidence                                                                                                                                        |
| ------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Zero / one / many workspace listing   | PASS   | `apps/web/test/integration/human-identity-slice.integration.test.ts`, `apps/console/test/integration/console-human-session.integration.test.ts` |
| Workspace header scoping              | PASS   | `apps/console/test/integration/console-human-session.integration.test.ts`                                                                       |
| Cross-workspace denial (BFF)          | PASS   | `apps/console/test/integration/console-human-session.integration.test.ts` (workspace B memberships, agent isolation A vs C)                     |
| Workspace switching / stale data      | PASS   | `apps/console/test/integration/console-human-session.integration.test.ts` (agents in A not visible in C)                                        |
| Membership removal invalidates access | PASS   | `apps/console/test/integration/console-human-session.integration.test.ts` (second test)                                                         |

## Roles and membership

| Item                                          | Status | Evidence                                                                                                                                      |
| --------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Five human roles (OWNER … VIEWER) UI matrix   | PASS   | `apps/console/test/human-role-mutation-matrix.test.ts`, `apps/console/test/agents-page.test.tsx`, `apps/console/test/workflows-page.test.tsx` |
| Owner invariant (last owner)                  | PASS   | `packages/db/test/integration/postgres-identity.integration.test.ts`, `apps/console/test/workspace-access-page.test.tsx`                      |
| Membership provisioning                       | PASS   | `apps/console/test/workspace-access-page.test.tsx`, `apps/web/test/integration/human-identity-slice.integration.test.ts`                      |
| Owner promote / transfer / demote / remove UI | PASS   | `apps/console/test/workspace-access-page.test.tsx`, `apps/console/src/client/routes/workspace-access-page.tsx`                                |
| ADMIN cannot manage OWNER rows (UI)           | PASS   | `apps/console/test/workspace-access-page.test.tsx`                                                                                            |

## Security and compatibility

| Item                                                     | Status | Evidence                                                                                                                              |
| -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Audit activity (human READ)                              | PASS   | `apps/console/src/client/routes/security-activity-page.tsx`, `apps/web/test/integration/human-identity-slice.integration.test.ts`     |
| Browser `Authorization` rejected                         | PASS   | `apps/console/test/human-session-bff.test.ts`, `apps/console/test/integration/console-human-session.integration.test.ts`              |
| No Console API key in browser payloads                   | PASS   | `apps/console/test/secret-leak.test.ts`, integration JSON assertions                                                                  |
| Default human mode (no mandatory `OSVA_CONSOLE_API_KEY`) | PASS   | `apps/console/test/config.test.ts`, `docs/engineering/CONSOLE.md`                                                                     |
| Legacy API-key BFF opt-in only                           | PASS   | `apps/console/test/config.test.ts`, `apps/console/test/integration/console-real-stack.integration.test.ts` (`legacyApiKeyMode: true`) |
| API-key machine compatibility                            | PASS   | `apps/console/test/integration/console-human-session.integration.test.ts` (direct `/v1/agents` with bootstrap key)                    |
| Recovery / session revocation                            | PASS   | `apps/web/test/integration/human-identity-slice.integration.test.ts`                                                                  |

## Local / Compose onboarding

| Item                                        | Status | Evidence                                                                               |
| ------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| Compose defaults human Console              | PASS   | `.env.example`, `docs/engineering/CONSOLE.md`, `docs/engineering/LOCAL_DEVELOPMENT.md` |
| Trusted origins include Console origin      | PASS   | `docs/architecture/HUMAN_AUTHENTICATION.md`, Console request guard tests               |
| Production requires real `OSVA_AUTH_SECRET` | PASS   | `docs/deployment/CONFIGURATION.md`, web startup validation                             |

## Deferred (post-M11)

OIDC, MFA, email delivery, SAML, SCIM, custom roles, and enterprise policy packs remain out of scope for M11 Slice 3. Track under future milestones; do not treat absence here as PASS.

## Verification commands (focused)

```bash
pnpm --filter @osva/console exec prettier --write <changed files>
pnpm --filter @osva/console lint
pnpm --filter @osva/console typecheck
pnpm --filter @osva/console test
pnpm --filter @osva/console test:integration
pnpm db:migrations:verify
git diff --check
```
