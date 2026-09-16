# ADR-006: Trusted TypeScript RuntimeAdapter

**Status:** Accepted for Stage 1 Slice 1.4

## Decision

OSVA's first production `RuntimeAdapter` executes operator-installed TypeScript
modules through a dedicated Node child process. The adapter lives in
`@osva/adapters-runtime-typescript` and is composed into `apps/worker` through
the existing Slice 1.3 RuntimeAdapter injection seam.

## Trust model

This is a trusted-code runtime. It executes artifacts the OSVA operator placed
under `OSVA_TRUSTED_RUNTIME_ROOT`. It is not a sandbox for hostile or
arbitrary user-submitted code.

Child processes, timeouts, and a scrubbed environment provide fault isolation
for the BullMQ worker. They do not make untrusted JavaScript safe.

## TypeScript loading

The repository already requires Node.js 24, which can import erasable
TypeScript. The child runner is compiled JavaScript shipped with the adapter.
Trusted agent entrypoints are loaded with Node's built-in type stripping.

tsx is not used. tsx depends on a native esbuild addon, which is incompatible
with a useful Node permission-model configuration. Adoption of `--permission`
must not require a Node baseline upgrade.

## Permission model

The trusted child is started with Node `--permission`, filesystem-read grants
for the child runner and trusted root, and without filesystem write, child
process, worker, or addon grants. This is defense-in-depth, not a security
sandbox. Network denial is not available on the repository's Node 24.13 CLI.

## Lifecycle ownership

`ExecuteRunAttempt` remains the orchestration owner. The runtime adapter does
not persist Run or RunAttempt state. Canonical output is stored on
`RunAttempt`.
