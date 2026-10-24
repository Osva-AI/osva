# M14.2 acceptance summary — human authentication CSRF and rate-limit hardening

## Security findings addressed

| Finding | Resolution |
| --- | --- |
| Empty `OSVA_AUTH_TRUSTED_ORIGINS` / invalid base URL could yield an empty allowlist and bypass CSRF checks | Config validation at startup; `assertTrustedOrigin` fails closed when the allowlist is empty |
| Untrusted or malformed `Origin` / `Referer` on mutating human routes | Strict origin normalization; no Referer fallback when `Origin` is present but untrusted |
| Authenticated human sessions counted against anonymous IP buckets | Human principals use `osva:rl:human:v1:<userId>` with the authenticated per-minute limit |
| Missing adversarial regression coverage | Extended unit and HTTP tests (see Test evidence) |

## CSRF invariants

- Protected mutating human-auth routes require a non-empty trusted-origin set at runtime (enforced at config load).
- Valid configured `Origin` passes; untrusted, malformed, or disallowed-scheme values fail.
- Missing `Origin` and `Referer` fails.
- Trusted `Referer` origin fallback applies only when `Origin` is absent.
- Better Auth flows remain on explicit `/v1/auth/*` handlers; OSVA origin checks run before route handlers without duplicating Better Auth session logic.

## Rate-limit bucket behavior

| Request class | Valkey key prefix | Identity |
| --- | --- | --- |
| Unauthenticated | `osva:rl:unauth:v1:` | Trusted source IP |
| API key | `osva:rl:key:v1:` | `workspaceId:apiKeyId` |
| Human session | `osva:rl:human:v1:` | `userId` (stable; not session token) |

Invalid or expired sessions do not populate human buckets. Valkey store failure remains fail-closed (`503 SERVICE_UNAVAILABLE`).

## Compatibility

- Better Auth configuration, cookies, login/logout/session/recovery unchanged.
- API-key rate limits and RBAC unchanged.
- Localhost `http` origins remain valid for development.

## Test evidence

- `apps/web/test/human-auth-csrf.test.ts` — CSRF matrix
- `apps/web/test/config.test.ts` — auth URL and trusted-origin validation
- `apps/web/test/http-rate-limit.test.ts` — human, API key, and anonymous buckets
- `apps/web/test/m14-2-human-security-http.test.ts` — HTTP integration (CSRF + human bucket + API key)
- `packages/contracts/test/human-auth.test.ts` — human rate-limit key material

## Deferred work

- Optional secondary per-IP cap on authenticated human traffic (multi-account abuse) — not required for M14.2
- Organization-level human disable/enable routes (already deferred post-M11)
