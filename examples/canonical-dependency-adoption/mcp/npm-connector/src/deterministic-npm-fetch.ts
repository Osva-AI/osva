import type { FetchLike } from "./npm-client.js";
import { NPM_DOWNLOADS_ORIGIN, NPM_REGISTRY_ORIGIN } from "./npm-client.js";

export interface NpmCallCounts {
  npmPackageMetadata: number;
  npmDownloads: number;
}

let metadataCalls = 0;
let downloadsCalls = 0;

export function resetDeterministicNpmCallCounts(): void {
  metadataCalls = 0;
  downloadsCalls = 0;
}

export function getDeterministicNpmCallCounts(): NpmCallCounts {
  return {
    npmPackageMetadata: metadataCalls,
    npmDownloads: downloadsCalls,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function createDeterministicNpmFetch(): FetchLike {
  return async (input) => {
    const url =
      input instanceof URL
        ? input
        : new URL(typeof input === "string" ? input : input.url);

    if (url.origin === NPM_REGISTRY_ORIGIN && url.pathname === "/zod") {
      metadataCalls += 1;
      return jsonResponse(200, {
        name: "zod",
        "dist-tags": { latest: "4.6.5" },
        license: "MIT",
        repository: { url: "git+https://github.com/colinhacks/zod.git" },
        time: { "4.6.5": "2026-03-01T00:00:00.000Z" },
        maintainers: [{ name: "a" }, { name: "b" }],
      });
    }

    if (
      url.origin === NPM_DOWNLOADS_ORIGIN &&
      url.pathname === "/downloads/point/last-month/zod"
    ) {
      downloadsCalls += 1;
      return jsonResponse(200, {
        downloads: 45_000_000,
        start: "2026-02-01",
        end: "2026-02-28",
        package: "zod",
      });
    }

    return jsonResponse(404, {
      error: "not found in deterministic npm fixture",
    });
  };
}
