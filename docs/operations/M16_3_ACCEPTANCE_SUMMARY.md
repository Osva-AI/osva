# M16.3 — Frictionless first-agent experience

## Scope

Console onboarding semantics, setup guidance, and browser acceptance for the no-code first-agent journey after installation. Reuses M12.3 human stack and M16.2D install harness patterns without duplicating install acceptance.

## Verification (development)

```bash
pnpm exec prettier --check <changed console files>
pnpm --filter @osva/console exec vitest run test/agent-onboarding.test.ts test/declarative-agent-manifest.test.ts test/agents-page.test.tsx
pnpm --filter @osva/console exec vitest run --config vitest.integration.browser.config.ts test/integration/m16-3-browser.integration.test.ts
```

Browser test uses deterministic fake OpenAI on the M12.3 stack (not live provider credentials).

## Key behavior

- Onboarding **inspect** completes only on Run **SUCCEEDED** for the onboarding AgentVersion.
- **Run** step completes when a matching Run exists (any status); status text distinguishes PENDING / QUEUED / RUNNING / terminal failure.
- Paginated run lists do not imply full history; optional `runId` query tracks a specific Run.
