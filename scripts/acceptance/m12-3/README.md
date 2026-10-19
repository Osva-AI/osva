# M12.3 cross-capability acceptance

Repeatable real-stack acceptance for model provider connections, MCP tools, combined execution, and Console human-session journeys.

## Quick start

```bash
pnpm install
pnpm acceptance:m12-3
```

Browser smoke (Playwright + Chromium):

```bash
pnpm acceptance:m12-3:browser
```

## Architecture

- **Option A (default):** Console BFF and SPA bind to loopback; web and worker run as host processes against disposable Docker PostgreSQL/Valkey (same pattern as `@osva/console` integration tests).
- **Deterministic fakes:** `adapters/model-openai/test/fake-openai-server.ts` and `@osva/adapters-mcp-client/testing` fake Streamable HTTP MCP.
- **Identity:** Real Better Auth human login (operator provisioned by owner); no API-key Console mode and no auth bypass.

## Optional profiles

### Self-hosted inference (Ollama)

Not part of the default CI gate. When Ollama is installed locally:

```bash
# Start Ollama with a small model, then:
OSVA_M12_3_OLLAMA_BASE_URL=http://127.0.0.1:11434/v1 \
OSVA_M12_3_OLLAMA_MODEL=llama3.2 \
node scripts/acceptance/m12-3/profiles/ollama-optional.mjs
```

Record PASS/FAIL in `docs/operations/M12_3_ACCEPTANCE_SUMMARY.md` operator evidence; CI remains on deterministic fakes.

### LiteLLM Proxy

Optional operator-only validation against a real LiteLLM process with a deterministic upstream fake. Not executed in default CI.

## Evidence

Integration tests write assertions only; wrapper emits JSON summary to stdout. For CI artifacts, rely on workflow logs (sanitized; no sentinel credentials).
