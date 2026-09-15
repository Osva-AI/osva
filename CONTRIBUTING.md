# Contributing to OSVA

OSVA is currently in its architecture and foundation phase.

Contributions are welcome, but architectural consistency is more important than feature volume.

## Read first

- `README.md`
- `AGENTS.md`
- `docs/00-DOCUMENTATION-MAP.md`
- `docs/architecture/ARCHITECTURAL_INVARIANTS.md`
- relevant public contracts and ADRs

## Good contributions

- documentation improvements;
- tests;
- bug fixes;
- performance work;
- runtime/model/tool adapters;
- examples;
- approved product features.

For large features or contract changes, open an issue or discussion first.

## Local setup

See the Stage 0 Development section in `README.md` for clone, install,
infrastructure, migrate, and quality commands.

## Development rules

### Preserve domain boundaries
Do not couple OSVA domain concepts directly to replaceable infrastructure.

### Keep pull requests focused
Prefer small reviewable changes.

### Add tests
Behavior changes should include appropriate tests.

### Update docs
Contract or behavior changes should update documentation in the same PR.

### Use ADRs
Changes to permanent architectural boundaries require an ADR.

## Commit examples

```text
docs: define runtime protocol
feat: add BullMQ job queue adapter
fix: preserve ToolVersion during retry
test: add runtime adapter contract tests
```

## Security

Do not report vulnerabilities through public issues. See `SECURITY.md`.

## License

Contributions are licensed under Apache License 2.0.
