# M14.4 Acceptance Summary — Adversarial Prompt-Injection & Authorized-Tool Misuse

Status: **READY FOR MANUAL COMMIT** (baseline `main` @ `18536c80798aa7944c69d36c5972dfcf7c6fa05d`; branch `feat/m14-4-adversarial-security`).

## Security posture (Community Edition)

- **Platform authorization** is enforced in trusted TypeScript (ToolGateway, MemoryGateway, capability bridge, outbound network policy, approval state machine, evaluation scoring). Untrusted text cannot grant new permissions.
- **Prompt injection** cannot be fully prevented by instructions alone. Declarative and trusted runtimes treat run input, retrieved knowledge, and tool results as untrusted data.
- **Authorized-tool misuse** remains possible when a bound tool accepts attacker-influenced arguments (measured as `AUTHORIZED_BUT_UNSAFE` in fixtures).
- **Fake-model tests** establish deterministic enforcement; they do **not** prove real LLM robustness (`TEST_LIMITATION`).

## Attack surface inventory

| Trust transition | Data source | Trust | Enforcement | Existing coverage | M14.4 addition |
| --- | --- | --- | --- | --- | --- |
| User input → agent | Run/workflow input | Untrusted | Frozen `ExecutionRequest` bindings | Declarative prefetch labels | Scenario 3, 7 |
| Retrieved knowledge → model | KnowledgeGateway hits | Untrusted | No binding expansion; declarative allowlist | `declarative-runtime-adapter.test.ts` prefetch | B1 fixtures + scenario 4 |
| MCP/tool result → model | Tool output JSON | Untrusted | Same allowlist + ToolGateway | M12.3 MCP adversarial agent (integration) | B2 declarative fake-model |
| Model → tool selection | Fake/provider model | Untrusted | `allowedToolBindings` / manifest tools | Declarative + trusted IPC | Scenarios 1–5, 13 |
| Model args → ToolGateway | Tool call JSON | Untrusted | Schema + workspace checks (M14.1) | `tool-gateway.test.ts` | Scenarios 1–2, B4 |
| Tool → memory/knowledge | Side effects | Mixed | MemoryGateway `allowPersistentMutation` | Memory gateway unit tests | Scenario 10 |
| Cross-agent text | Workflow/prior output | Untrusted | Per-run bindings | Workflow e2e (approval) | Scenario 7 |
| Remote runtime → bridge | HTTP capability token | Authenticated attempt | Token + RunAttempt state (M14.3) | `capability-bridge.test.ts` | **Reused** scenarios 6, 14 (not new M14.4 tests) |
| Approval text → workflow | Agent/user narrative | Untrusted | Persisted `ApprovalRequest` only | Domain + orchestrator e2e | Scenario 8 (domain unit only) |
| Agent output → evaluation | Run output | Untrusted | Coordinator + domain scoring | M13 quality gate tests | Scenario 9 (scoring unit only) |
| Outbound URLs | Tool/MCP/remote config | Untrusted influence | `evaluateRemoteHttpDestination` | `outbound-network` tests | Scenario 11 |

## Adversarial fixture catalog

Package: `@osva/adversarial-acceptance` (`packages/adversarial-acceptance/src/fixtures/attack-content.ts`).

| ID | Class | Fixture |
| --- | --- | --- |
| B1 | Retrieved knowledge injection | `RETRIEVED_KNOWLEDGE_INJECTION` |
| B2 | MCP tool-response injection | `MCP_TOOL_RESPONSE_INJECTION` |
| B3 | User-input authority override | `USER_INPUT_AUTHORITY_OVERRIDE` |
| B4 | Tool argument manipulation | Fake-model echo args + permissive schema |
| B5 | Multi-agent laundering | `launderedPriorAgentOutput()` |
| B6 | Secret exfiltration probes | `FAKE_OSVA_API_KEY`, `FAKE_PROVIDER_SECRET` |
| B7 | SSRF / private network | Loopback + link-local URLs in fixtures |
| B8 | Approval spoofing | `FORGED_APPROVAL_NARRATIVE` |
| B9 | Evaluation contamination | `EVALUATION_STATUS_FORGERY` |

Report classifications: `BLOCKED_BY_PLATFORM`, `AUTHORIZED_BUT_UNSAFE`, `TEST_LIMITATION` (`enforcement-outcomes.ts`).

## Minimum acceptance scenarios (threat → test)

**New M14.4 executable tests:** `@osva/adversarial-acceptance` — **12** Vitest cases (11 scenario-focused + 1 classification meta-test). Scenarios **6**, **12**, and **14** are **not** covered by that package; they use **reused** tests listed below.

| # | Scenario | Coverage | New vs reused | Deterministic | Result / notes |
| ---: | --- | --- | --- | ---: | --- |
| 1 | Unbound / mismatched ToolVersion | `m14-4-adversarial-acceptance.test.ts` (`1–2…`) + `tool-gateway.test.ts` (M14.1) | Mixed | Yes | BLOCKED_BY_PLATFORM |
| 2 | Foreign workspace ToolVersion | Same M14.4 test + `tool-gateway.test.ts` | Mixed | Yes | BLOCKED_BY_PLATFORM |
| 3 | User input binding override ignored | `m14-4-adversarial-acceptance.test.ts` (`3: user input…`) | **New** (fake model) | Yes | Override fields ignored; **run succeeded** with frozen `workspaceId` / `toolVersionId` on ToolGateway auth (`TEST_LIMITATION` on model path) |
| 4 | Malicious knowledge cannot expand tools | `m14-4-adversarial-acceptance.test.ts` (`4–5…`, knowledge half) | **New** | Yes | BLOCKED_BY_PLATFORM + fake model |
| 5 | Malicious MCP payload cannot expand tools | Same file (`4–5…`, MCP half) | **New** | Yes | BLOCKED_BY_PLATFORM + fake model |
| 6 | Client `toolVersionId` on capability invoke | `adapters/runtime-http/test/capability-bridge.test.ts` — `invokes tools through ToolGateway and rejects unbound tools` (HTTP **400** on client `toolVersionId`) | **Reused** (M14.1/M14.3) | Yes | BLOCKED_BY_PLATFORM |
| 7 | Cross-agent text cannot transfer permissions | `m14-4-adversarial-acceptance.test.ts` (`7: cross-agent…`) | **New** | Yes | BLOCKED_BY_PLATFORM + fake model |
| 8 | Forged approval text | `m14-4-adversarial-acceptance.test.ts` (`8: forged approval…`) + `packages/domain/test/approval-request.test.ts` | **New** domain unit only | Yes | Narrative does not mutate `ApprovalRequest`; **orchestration-level approval spoofing not exercised here** |
| 9 | Evaluation gate not forged by agent JSON | `m14-4-adversarial-acceptance.test.ts` (`9: evaluation quality gate…`) | **New** scoring unit only | Yes | `assessEvaluationQualityGate` uses trusted summary; **forgery fixture not passed into scorer** |
| 10 | Evaluation memory writes blocked | `m14-4-adversarial-acceptance.test.ts` (`10: evaluation child runs…`) | **New** | Yes | BLOCKED_BY_PLATFORM |
| 11 | Private-network destinations | `m14-4-adversarial-acceptance.test.ts` + `outbound-network` tests | Mixed | Yes | BLOCKED_BY_PLATFORM (stub `lookup`, no live metadata calls) |
| 12 | Credential redaction in public errors | `adapters/runtime-typescript/test/public-error.test.ts` | **Reused** pattern (M14.4 regression) | Yes | BLOCKED_BY_PLATFORM (redaction policy) |
| 13 | Tool/model budgets | `m14-4-adversarial-acceptance.test.ts` (`13: repeated…`) | **New** | Yes | BLOCKED_BY_PLATFORM (budget exercised) + fake model |
| 14 | Terminal RunAttempt capabilities | `capability-bridge.test.ts` — `rejects capability calls when the attempt is %s`, `rejects a token after the RunAttempt leaves RUNNING` | **Reused** (M14.3) | Yes | BLOCKED_BY_PLATFORM |
| 15 | Legitimate echo still succeeds | `m14-4-adversarial-acceptance.test.ts` (`15: legitimate…`) | **New** | Yes | Allowed control path |

## Authorized-but-unsafe findings

- Declarative agents with permissive ToolVersion input schemas can **echo attacker-chosen JSON** (including synthetic secrets) through an authorized `echo` binding. Mitigation path: connector/tool schema tightening, approval gates, egress policy — not prompt sanitization alone.

## Known limitations

- No live LLM or paid provider calls in this slice.
- Docker MCP/worker integration adversarial paths rely on M12.3 + existing integration tests (not re-run in M14.4 gate).
- M13 evaluation **quality gates** measure case outcomes; they are **not** platform security enforcement.
- M13 evaluation **suites** can represent pass/fail outcomes; security classifications remain in Vitest fixtures until a dedicated security evaluator contract exists.
- Payload-hash / operation-bound approvals remain **M14.5** (text spoofing blocked at persisted approval state only; workflow resume integrity not fully covered by M14.4).

## Recommended M14.5 scope

- Operation-hash approval binding and resume integrity.
- Optional security evaluator cases wired into EvaluationSuiteVersion without conflating quality PASS with platform security proof.
- Expanded authorized-tool misuse metrics (connector egress, idempotency abuse).

## Verification evidence

| Command | Exit code | Notes |
| --- | ---: | --- |
| `pnpm verify:changed` | **0** | **1042.8s** total; full workspace (47 packages) because `pnpm-lock.yaml` changed for new package |
| └ FORMAT | PASS | 2.8s |
| └ LINT | PASS | 113.9s — **43/43** tasks |
| └ TYPECHECK | PASS | 284.7s — **81/81** tasks |
| └ TEST | PASS | 579.7s — **82/82** tasks |
| └ BUILD | PASS | 59.2s — **46/46** tasks |
| └ GITDIFF | PASS | 365ms |
| Pre-commit cleanup (focused) | (see final report) | Prettier + targeted package tests after doc/test corrections |

Not executed in M14.4 slice: `pnpm verify:ci:clean` (operator pre-merge gate).

## Build artifacts

`packages/adversarial-acceptance/dist/` is produced by `pnpm build` and is covered by root `.gitignore` (`dist/`). Do not commit generated `dist/` output.

## Release-blocking findings

None identified in this slice (no Critical/High authorization bypass demonstrated).
