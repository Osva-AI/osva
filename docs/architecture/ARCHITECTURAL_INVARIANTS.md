# Architectural Invariants

1. Run is an OSVA product concept.
2. RunAttempt is a canonical OSVA identity.
3. Executed versions are immutable.
4. Infrastructure is accessed through ports.
5. Control and execution planes remain separate.
6. OSVA owns Workflow definitions.
7. Tool access is permission-mediated.
8. Provider SDK types do not enter domain contracts.
9. Canonical telemetry semantics belong to OSVA.
10. Secrets are references.
11. Memory and knowledge are pluggable.
12. Public contracts are versioned.
13. Multi-agent behavior is Workflow composition.
14. Human approval is a Workflow state.
15. Scaling changes topology, not product nouns.
16. ExecutionWorker and OfficeWorker are different concepts.
17. Retries reuse immutable dependency bindings.
18. Idempotency identifies logical operations, not attempts.
19. Workflow is an OSVA product object.
20. WorkflowVersion is immutable and a WorkflowRun always executes one WorkflowVersion.
21. Workflow definitions reference immutable AgentVersions.
22. WorkflowNodeRun is canonical identity for one workflow-node execution.
23. One AGENT WorkflowNodeRun maps to one canonical child Run. BRANCH, PARALLEL, and JOIN are OSVA orchestration nodes and never create Runs.
24. Workflow orchestration state belongs to PostgreSQL; BullMQ is never workflow lifecycle authority.
25. Workflow Definition V1 remains backward-compatible; V2 is an immutable DAG of AGENT, BRANCH, PARALLEL, and JOIN.
26. DAG execution state is derived from durable PostgreSQL WorkflowRun and WorkflowNodeRun rows.
27. Branch decisions are deterministic and durable; inactive paths become durably SKIPPED.
28. Explicit PARALLEL owns fan-out; explicit JOIN owns fan-in; JOIN aggregation is deterministic.
29. Multiple ready AGENT nodes may execute concurrently; reconciliation is idempotent and multi-orchestrator safe.
30. Already-started parallel child Runs cannot resurrect a FAILED WorkflowRun.
