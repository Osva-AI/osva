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
