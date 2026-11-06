# M20.2 — Natural-language builder generation service

## Status

Implemented in `@osva/domain/builder` (internal export). No public HTTP contract in M20.2.

## Ownership

| Layer | Component |
|-------|-----------|
| Domain / application | `GenerateBuilderProposalFromNaturalLanguage` |
| Pure builder | Existing M20.1 `parseBuilderProposalV1`, `compileBuilderProposalPrePublication`, `GetWorkspaceBuilderCapabilityCatalog` |
| Infrastructure | Caller supplies `ModelGateway` (e.g. `@osva/model-gateway`) |

Dependency direction: domain builder application depends only on `@osva-ai/contracts` types and domain ports (`WorkspaceRepository`, `AgentRepository`, `ModelProfileRepository`, `ToolRepository`); it does **not** import `@osva/model-gateway` to avoid a package cycle.

## Request / result

- **Request** — `GenerateBuilderProposalRequestV1` (`scope`, `userInstruction`, optional `generationModelProfileVersionId`, optional `preferences` for execution model hints).
- **Result** — `GenerateBuilderProposalResultV1`: success carries `proposal`, empty `compileIssues` when ok, `metadata` (prompt version, provider, attempts, catalog counts, truncation flag) or typed `BuilderGenerationErrorCode`.

Generation model (ModelProfileVersion for **inference**) is distinct from model bindings inside NEW agents (**execution**), documented in types and prompt.

## Flow

1. Control-plane READ authorization for agent, model profile, and tool resources (aligned with catalog).
2. Resolve generation `ModelProfileVersion`; workspace ownership check.
3. **Provider gate:** only `OPENAI` and `GOOGLE_GEMINI` profiles are accepted — they support `GenerateCompletionRequest.jsonSchema` in existing adapters. **Anthropic** returns `UNSUPPORTED_STRUCTURED_OUTPUT` (no silent fallback).
4. `GetWorkspaceBuilderCapabilityCatalog` → deterministic bounded JSON for the prompt.
5. `ModelGateway.generateCompletion` with a minimal OpenAI-style `json_schema` envelope (`BuilderProposalOpenAiJsonSchema`) plus strict downstream `parseBuilderProposalV1` + `compileBuilderProposalPrePublication`.
6. At most **two** provider calls when the first output fails validation (bounded repair).

## Prompt

- **Version:** `BUILDER_GENERATION_PROMPT_VERSION` (`"1"`).
- **Module:** `builder-natural-language-prompt.ts` — deterministic system copy + delimited catalog and user segments.

## Budgets

Defaults in `DEFAULT_BUILDER_GENERATION_LIMITS` (catalog entry caps, serialized catalog size, user instruction size, total deadline, per-attempt `maxOutputTokens`, `maxProviderInvocations: 2`).

## Security and trust

- Workspace id from `ControlPlaneScope` only; proposal content never sets workspace.
- Catalog and user text are untrusted; no secrets or credentials in prompts.
- No publication, no tool execution, no agent execution, no DB writes in the service.

## Deferred (M20.3+)

- Console / BFF HTTP surface
- Anthropic structured output if/when adapter supports schema-constrained JSON equivalent to OpenAI/Gemini
- Conversational refinement (M20.5), publication (M20.4)

## Verification

See commands in the M20.2 completion report; authoritative checks: Prettier, ESLint and TypeScript on `@osva/domain`, Vitest `packages/domain/test/builder-natural-language-generation.test.ts`.
