# M20.6 builder product acceptance

See `docs/implementation/M20-6-BUILDER-PRODUCT-ACCEPTANCE.md` and `docs/operations/M20_6_ACCEPTANCE_SUMMARY.md`.

```bash
pnpm acceptance:m20-6:test
pnpm acceptance:m20-6:smoke
pnpm acceptance:m20-6:browser
```

Live provider (operator only):

```bash
OSVA_M20_6_LIVE=1 OPENAI_API_KEY=... pnpm acceptance:m20-6:live -- --provider=openai --smoke
```
