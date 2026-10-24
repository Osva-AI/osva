# Policy, Security, and Governance

Policy enforcement points include:

- Run creation;
- Agent activation;
- model call;
- Tool call;
- knowledge access;
- approval;
- budget threshold.

Stable interface:

```text
authorize(subject, action, resource, context)
```

Early implementations may use simple grants.

Later implementations may use richer policy engines without changing callers.

## Adversarial acceptance (M14.4)

Automated fixtures in `@osva/adversarial-acceptance` exercise prompt-injection
and authorized-tool misuse against real OSVA gateways and declarative runtime
paths. Outcomes are reported as:

- **BLOCKED_BY_PLATFORM** — trusted code rejected the privileged operation.
- **AUTHORIZED_BUT_UNSAFE** — a permitted tool ran with attacker-influenced args.
- **TEST_LIMITATION** — fake-model harness; not proof of production LLM behavior.

Human approval remains workflow state in PostgreSQL; narrative “already approved”
text in run input or tool output does not substitute for a persisted decision
(operation-hash binding is planned for M14.5). See
`docs/operations/M14_4_ACCEPTANCE_SUMMARY.md`.
