# Implementation Tracker

Status is recorded after locally verifiable checks for each slice.

## Stage 0

- ✅ 0.1 Monorepo, packages, and public contracts
- ✅ 0.2 Domain model and state machines
- ✅ 0.3 Memory adapters and fakes
- ✅ 0.4 JobQueue and RuntimeAdapter test adapters
- ✅ 0.5 PostgreSQL persistence
- ✅ 0.6 Orchestration and runtime-core walking skeleton
- ✅ 0.7 Web and Worker process shells
- ✅ 0.8 Local Infrastructure, CI, and Stage 0 Acceptance

## Stage 1

- ✅ 1.1 Agent Registry and Version Management
- ✅ 1.2 Run Lifecycle API and Persistence Hardening
- ✅ 1.3 BullMQ + Valkey Queue Adapter and ExecutionWorker
- ✅ 1.4 Trusted TypeScript Runtime
- ✅ 1.5 Model Gateway and First Provider
- ✅ 1.6 Tool Gateway and Internal Tools
- ✅ 1.7 RunSteps, Usage/Cost, and JSON_EXACT_MATCH Evaluation
- ✅ 1.8 Recurring Scheduling

## Stage 2

- ✅ 2.1 Workflow Registry, WorkflowVersion, and Sequential Execution
- ✅ 2.2 Branch and parallel workflow nodes
- ✅ 2.3 Multi-agent composition and approval primitive
- ✅ 2.4 Runtime Protocol and Remote HTTP runtime
- ✅ 2.5 Node SDK, Python SDK, CLI, and public SDK surface
- ✅ 2.6 Additional model providers
- ✅ 2.7 MCP client and connector foundation
- ✅ 2.8 Memory namespaces and EvaluationSuites
- ✅ 2.9A OpenTelemetry foundation
- ✅ 2.9B Basic AI Office
- ✅ 2.9C Community Beta readiness

## Stage 3

- ✅ 3.1 Container Runtime and Execution Isolation
- ✅ 3.2 Durable workflow semantics
- ✅ 3.3 Durable workflow backend
- ✅ 3.4 Artifact storage
- ✅ 3.5 Knowledge retrieval
- ✅ 3.6 MCP server + connector SDK
- ✅ 3.7 API security and stability
- ✅ 3.8 OSS 1.0 deployment and release packaging (OSS 1.0 implementation and release acceptance complete)

## Totals

- Stage 0: 8/8 complete
- Stage 1: 8/8 complete
- Stage 2: 9/9 complete
- Stage 3: 8/8 complete
- Overall: 33/33 OSS 1.0 slices complete

**Community Beta:** complete
**OSS 1.0:** OSVA 1.0.0 release (33/33 slices; in-repo gates and Linux release-readiness CI verified; registry artifact availability depends on publication)

## Post-1.0 Community (in-repository)

- ✅ M7 Canonical dependency-adoption example and operator commands
- ✅ M8 Product Console (agents, workflow builder, runs, artifacts)
- ✅ M9.7 Production acceptance harness and sanitized evidence matrix
- ✅ M10 Developer experience and release packaging (through M10.4 published **`1.1.0-rc.2`**)
- ✅ M11 Human identity, authentication, and Console human sessions (Slices 1–3) — [`../operations/M11_CLOSEOUT_SUMMARY.md`](../operations/M11_CLOSEOUT_SUMMARY.md)
- ✅ M12 Model, Tool and Connector Capability Foundation
  - ✅ M12.1 Model provider connections and self-hosted model foundation — [`../operations/M12_1_ACCEPTANCE_SUMMARY.md`](../operations/M12_1_ACCEPTANCE_SUMMARY.md)
  - ✅ M12.2 Tool/connector management and MCP discovery — [`../operations/M12_2_ACCEPTANCE_SUMMARY.md`](../operations/M12_2_ACCEPTANCE_SUMMARY.md)
  - ✅ M12.3 Cross-capability integration and self-hosted acceptance — [`../operations/M12_3_ACCEPTANCE_SUMMARY.md`](../operations/M12_3_ACCEPTANCE_SUMMARY.md)
  - ✅ M12.4 External ecosystem and registered artifact storage — [`../operations/M12_4_CLOSEOUT_SUMMARY.md`](../operations/M12_4_CLOSEOUT_SUMMARY.md)
- ✅ M13 No-code product Console (Agent, Knowledge, Workflow, Testing studios) — [`../operations/M13_CLOSEOUT_SUMMARY.md`](../operations/M13_CLOSEOUT_SUMMARY.md) · [`../operations/M13_ACCEPTANCE_SUMMARY.md`](../operations/M13_ACCEPTANCE_SUMMARY.md)
  - ✅ M13.1A Declarative agent manifest contracts — [`../adr/ADR-009-declarative-agent-runtime.md`](../adr/ADR-009-declarative-agent-runtime.md)
  - ✅ M13.2 Declarative runtime adapter (`@osva/adapters-runtime-declarative`)
  - ✅ M13.3 No-code Agent Studio — `apps/console/test/integration/m13-3-browser.integration.test.ts`
  - ✅ M13.4 Workspace overview and onboarding shell — `apps/console/test/integration/m13-4-browser.integration.test.ts`
  - ✅ M13.5 Knowledge and memory studio shell — `apps/console/test/integration/m13-5-browser.integration.test.ts`
  - ✅ M13.5.1 Automated branch verification gate — `scripts/verification/branch-impact.mjs`
  - ✅ M13.6 No-code workflow builder — `apps/console/test/integration/m13-6-browser.integration.test.ts`
  - ✅ M13.7 Testing Studio
    - ✅ M13.7.1 Testing Studio landing — `apps/console/test/testing-studio-page.test.tsx`, `apps/console/test/integration/m13-7-2-browser.integration.test.ts`
    - ✅ M13.7.2 Agent Playground — `apps/console/test/integration/m13-7-2-browser.integration.test.ts`
    - ✅ M13.7.3 Test suite builder — `apps/console/test/integration/m13-7-3-browser.integration.test.ts`
    - ✅ M13.7.4 Batch evaluation launch and results — `apps/console/test/integration/m13-7-4-browser.integration.test.ts`
    - ✅ M13.7.5 Scoring and safety gates (Slices A–D) — [`../operations/M13_7_5_CLOSEOUT_SUMMARY.md`](../operations/M13_7_5_CLOSEOUT_SUMMARY.md) · [`../operations/M13_7_5_ACCEPTANCE_SUMMARY.md`](../operations/M13_7_5_ACCEPTANCE_SUMMARY.md)
- ✅ M14 Security hardening and closeout (Community **`1.1.0-rc.4`** security line) — [`../operations/M14_7_SECURITY_CLOSEOUT.md`](../operations/M14_7_SECURITY_CLOSEOUT.md) · merged **`main`** through PR **#51–#55** (`da9fb21` M14.1 → `6228f91` M14.5–M14.7)
  - ✅ M14.0 Security audit and evidence reconciliation (prerequisite) — cited in [`../operations/M14_1_ACCEPTANCE_SUMMARY.md`](../operations/M14_1_ACCEPTANCE_SUMMARY.md)
  - ✅ M14.1 Tool and MCP authorization hardening — [`../operations/M14_1_ACCEPTANCE_SUMMARY.md`](../operations/M14_1_ACCEPTANCE_SUMMARY.md) · PR **#51**
  - ✅ M14.2 Human auth CSRF origins and session rate limits — [`../operations/M14_2_ACCEPTANCE_SUMMARY.md`](../operations/M14_2_ACCEPTANCE_SUMMARY.md) · PR **#52**
  - ✅ M14.3 Runtime capability tokens and listener bind hardening — [`../operations/M14_3_ACCEPTANCE_SUMMARY.md`](../operations/M14_3_ACCEPTANCE_SUMMARY.md) · PR **#53**
  - ✅ M14.4 Adversarial acceptance fixtures and tests — [`../operations/M14_4_ACCEPTANCE_SUMMARY.md`](../operations/M14_4_ACCEPTANCE_SUMMARY.md) · PR **#54**
  - ✅ M14.5 Operation-bound human approval security — [`../operations/M14_5_ACCEPTANCE_SUMMARY.md`](../operations/M14_5_ACCEPTANCE_SUMMARY.md) · migration **`0030_approval_operation_binding_slice`** · PR **#55**
  - ✅ M14.6 Security audit durability and incident response — [`../operations/M14_6_ACCEPTANCE_SUMMARY.md`](../operations/M14_6_ACCEPTANCE_SUMMARY.md) · [`../operations/SECURITY_INCIDENT_RESPONSE.md`](../operations/SECURITY_INCIDENT_RESPONSE.md) · PR **#55**
  - ✅ M14.7 Security closeout — [`../operations/M14_7_SECURITY_CLOSEOUT.md`](../operations/M14_7_SECURITY_CLOSEOUT.md) · PR **#55** · `release-readiness` **success** on merge commit **`6228f910e0c4ad64a68dec15be4b8e92051775d0`**

**Release baseline (M15.1):** Git tag **`v1.1.0-rc.4`** → **`cd38eea46b8ee44bb099ccf307818cfcd348f50b`** (`fix(security): remediate RC4 dependency vulnerabilities (#58)`). Repository **`VERSION`**: **`1.1.0-rc.4`**. Drizzle journal head: **`0030_approval_operation_binding_slice`**.

## M15 — Production adoption and operational experience (planned)

See [`../implementation/M15-PRODUCTION-ADOPTION-OPERATIONAL-EXPERIENCE.md`](../implementation/M15-PRODUCTION-ADOPTION-OPERATIONAL-EXPERIENCE.md).

- ✅ M15.1 Baseline and roadmap reconciliation (documentation) — [`../implementation/M15-PRODUCTION-ADOPTION-OPERATIONAL-EXPERIENCE.md`](../implementation/M15-PRODUCTION-ADOPTION-OPERATIONAL-EXPERIENCE.md) · baseline tag **`v1.1.0-rc.4`** / **`cd38eea`**
- ⬜ M15.2 Evaluation Studio browser acceptance
- ⬜ M15.3 Operator experience hardening
- ⬜ M15.4 Unified adoption acceptance
- ⬜ M15.5 Production adoption closeout
