# B4 Intelligent Model Routing

## Scope

Optional workspace-scoped intelligent model routing above provider adapters and below workspace authorization. Default product behavior is unchanged (`inferenceRouting.enabled: false`).

## Architecture

```text
ExecutionRequest.policyContext.inferenceRouting
  → RunStep recorder (per provider attempt)
  → CachingModelGateway (optional B1; uses selected model id)
  → RoutingModelGateway (B4)
  → ModelGateway
  → Provider adapter
```

Per-execution composition (worker):

```text
RoutingModelGateway(
  inner = RunStepRecorder.wrap( CachingModelGateway( ModelGateway ) )
)
```

Evaluation judge calls use bare `ModelGateway` (no routing). Runs with `evaluationContext` do not receive routing options.

Routing selects an authorized immutable `ModelProfileVersion` before provider invocation. Cache identity (B1) remains bound to the selected model.

## Policies

Immutable versioned definitions (`inference_routing_policy_versions`) with workspace activation (`workspace_inference_routing_activation`).

Strategies:

- `FIXED`
- `LOWEST_ESTIMATED_COST` (priced candidates only; unknown cost excluded from cheapest rank by default)
- `LOWEST_MEASURED_LATENCY` (requires `INFERENCE_ROUTING_LATENCY_MIN_SAMPLES`; otherwise policy order)
- `BALANCED`
- `PRIORITY_WITH_FALLBACK`

## Authorization

Candidates must:

- Belong to the same workspace via `ModelProfile`
- Resolve provider connection in-workspace when connection-bound
- Satisfy explicit capability requirements using `MODEL_INFERENCE_ROUTING_CAPABILITIES`
- Pass circuit-breaker eligibility

Fail closed when no eligible candidate exists (`MODEL_ROUTING_NO_ELIGIBLE_CANDIDATE`).

## Cost and latency

- Preflight cost uses immutable pricing + heuristic input tokens (`estimateRoutingInputTokens`)
- Unknown pricing is not treated as cheapest
- Latency ranking uses in-worker rolling samples (`InferenceRoutingLatencyStore`); insufficient evidence falls back to deterministic policy order

## Health

`InferenceRoutingCircuitBreakerRegistry` tracks retryable failures per workspace/model/connection with bounded windows (default settings in `INFERENCE_ROUTING_DEFAULT_CIRCUIT_BREAKER`).

## Fallback

Allowed only when `allowFallback: true` and errors are retryable. No fallback for auth/invalid/budget/cancel/content-blocked classes.

Streaming: route selection occurs before provider stream starts; no cross-model interleaving in B4.1.

## Budget

`maxEstimatedCostUsdMicros` is a soft preflight admission guard (estimate-only). Hard atomic workspace spend reservation is **not** implemented in B4.1 (scenario O deferred).

## Persistence

Migration `0043_inference_routing_slice`:

- Policy + version tables
- Workspace activation
- Optional routing decision records (`inference_routing_decisions`)

## APIs

Control plane (ADMIN for mutation, READ for inspection):

- `POST /v1/inference-routing-policies`
- `GET /v1/inference-routing-policies`
- `POST /v1/inference-routing-policies/:id/versions`
- `POST /v1/inference-routing-policies/activate`
- `GET /v1/inference-routing-policy-versions/:id`
- `GET /v1/inference-routing-decisions/:id`

## Balanced strategy

`BALANCED` ranks candidates by normalized cost and latency ranks (not raw micro-USD + milliseconds). Unknown pricing or latency receive a large rank penalty and fall back deterministically toward policy order.

## Provider attempts

Each fallback provider call flows through `RunStepRecorder` on the inner stack, producing one RunStep per billable attempt. `inference_routing_decisions` stores a single decision record per routed invocation with attempt history.

## Decision persistence

Worker persists decisions best-effort. Persistence failures are logged and do not fail the Run.

## Deferred

See [B4_ROUTING_ACCEPTANCE_SUMMARY.md](../operations/B4_ROUTING_ACCEPTANCE_SUMMARY.md).