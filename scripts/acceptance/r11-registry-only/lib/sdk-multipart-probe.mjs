import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Compare published SDK multipart upload vs raw fetch FormData.
 *
 * @param {string} installRoot
 * @param {string} baseUrl
 * @param {string} apiKey
 */
export async function probeSdkMultipart(installRoot, baseUrl, apiKey) {
  const scriptPath = path.join(installRoot, "sdk-multipart-probe.mjs");
  await writeFile(
    scriptPath,
    `import { randomUUID } from "node:crypto";
import { OsvaClient } from "@osva-ai/sdk";

const baseUrl = ${JSON.stringify(baseUrl)};
const apiKey = ${JSON.stringify(apiKey)};
const body = "r11 sdk multipart probe";

const client = new OsvaClient({ baseUrl, apiKey, timeoutMs: 120_000 });

function serializeCause(error) {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const cause = error.cause;
  if (!(cause instanceof Error)) {
    return undefined;
  }
  /** @type {Record<string, unknown>} */
  const out = { message: cause.message, name: cause.name };
  if ("code" in cause && typeof cause.code === "string") {
    out.code = cause.code;
  }
  if ("errno" in cause && typeof cause.errno === "number") {
    out.errno = cause.errno;
  }
  return out;
}

/** @type {Record<string, unknown>} */
const result = { sdk: null, fetch: null, nodeVersion: process.version };

const ready = await fetch(\`\${baseUrl}/ready\`);
if (!ready.ok) {
  console.log(JSON.stringify({ ...result, ready: ready.status }));
  process.exit(0);
}

try {
  const form = new FormData();
  form.set("name", "r11-fetch-multipart-probe.txt");
  form.append("file", new Blob([body], { type: "text/plain" }), "probe.txt");
  const response = await fetch(\`\${baseUrl}/v1/artifacts\`, {
    method: "POST",
    headers: {
      authorization: \`Bearer \${apiKey}\`,
      "idempotency-key": randomUUID(),
    },
    body: form,
  });
  if (!response.ok) {
    result.fetch = { ok: false, status: response.status, body: await response.text() };
  } else {
    result.fetch = { ok: true, artifactId: (await response.json()).id };
  }
} catch (error) {
  result.fetch = {
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    cause: serializeCause(error),
  };
}

try {
  const blob = new Blob([body], { type: "text/plain" });
  const created = await client.artifacts.create({
    name: "r11-sdk-multipart-probe.txt",
    content: blob,
    mediaType: "text/plain",
    idempotencyKey: randomUUID(),
  });
  result.sdk = { ok: true, artifactId: created.id };
} catch (error) {
  result.sdk = {
    ok: false,
    name: error?.constructor?.name ?? "Error",
    message: error instanceof Error ? error.message : String(error),
    cause: serializeCause(error),
  };
}

console.log(JSON.stringify(result));
`,
  );
  const run = spawnSync(process.execPath, [scriptPath], {
    cwd: installRoot,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    throw new Error(
      `SDK multipart probe script failed: ${run.stderr || run.stdout}`,
    );
  }
  return JSON.parse(run.stdout.trim());
}
