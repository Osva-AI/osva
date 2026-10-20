# M12.4.3 artifact adapter external consumer acceptance

Validates that an independently maintained package can:

1. Depend on a **packed** `@osva-ai/contracts` tarball (not workspace resolution).
2. Implement `ArtifactBlobStore` and `RegisteredArtifactBlobStoreModule`.
3. Typecheck without `@osva/domain`, `@osva/db`, or other private OSVA packages.

Also runs in-repo registered-module loader tests via `@osva/adapters-artifact-storage`.

```bash
node scripts/acceptance/m12-4-3/run.mjs
```

Runtime integration with worker/web requires a trusted OSVA distribution that lists the adapter package in `node_modules` and sets:

- `OSVA_ARTIFACT_STORAGE_DRIVER=registered`
- `OSVA_ARTIFACT_BLOB_STORE_REGISTER_MODULE=<package entry or file URL>`

See [M12_4_3_ACCEPTANCE_SUMMARY.md](../../docs/operations/M12_4_3_ACCEPTANCE_SUMMARY.md).
