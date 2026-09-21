import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceId } from "@osva/contracts";
import {
  WORKFLOW_EVENT_CORRELATION_KEY_MAX_LENGTH,
  WORKFLOW_EVENT_HTTP_REQUEST_MAX_BYTES,
  WORKFLOW_EVENT_IDEMPOTENCY_KEY_MAX_LENGTH,
  WORKFLOW_EVENT_SOURCE_MAX_LENGTH,
  WORKFLOW_EVENT_TYPE_MAX_LENGTH,
} from "@osva/contracts";

import { closeHttpServer, listenHttpServer } from "../src/server.js";
import {
  authHeadersForKey,
  fetchJson,
  setTestAuthHeaders,
} from "./http-test-helpers.js";
import { TEST_NOW, createTestWebApplication } from "./test-web.js";

const WORKSPACE_ID = "ws-workflow-events" as WorkspaceId;

describe("POST /v1/workflow-events", () => {
  const servers: import("node:http").Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map((server) => closeHttpServer(server)),
    );
  });

  it("ingests a valid event and returns OSVA-owned id and receivedAt", async () => {
    const { origin } = await listen();
    const body = validBody();
    const response = await postEvent(origin, body);

    expect(response.status).toBe(200);
    const resource = response.body as Record<string, unknown>;
    expect(resource.id).toBe("workflow-event-1");
    expect(resource.workspaceId).toBe(WORKSPACE_ID);
    expect(resource.source).toBe("Payments");
    expect(resource.eventType).toBe("invoice.Paid");
    expect(resource.correlationKey).toBe("ord-1");
    expect(resource.receivedAt).toBe(TEST_NOW.toISOString());
  });

  it("accepts optional occurredAt as canonical UTC instant", async () => {
    const { origin } = await listen();
    const occurredAt = "2026-09-19T10:00:00.000Z";
    const response = await postEvent(origin, { ...validBody(), occurredAt });
    expect(response.status).toBe(200);
    expect((response.body as { occurredAt?: string }).occurredAt).toBe(
      occurredAt,
    );
  });

  it("rejects invalid occurredAt", async () => {
    const { origin } = await listen();
    const response = await postEvent(origin, {
      ...validBody(),
      occurredAt: "2026-09-19T10:00:00+00:00",
    });
    expect(response.status).toBe(400);
  });

  it("rejects client-supplied id and receivedAt fields", async () => {
    const { origin } = await listen();
    const withId = await postEvent(origin, {
      ...validBody(),
      id: "client-id",
    });
    expect(withId.status).toBe(400);

    const withReceivedAt = await postEvent(origin, {
      ...validBody(),
      receivedAt: TEST_NOW.toISOString(),
    });
    expect(withReceivedAt.status).toBe(400);
  });

  it("rejects empty and oversized identity strings", async () => {
    const { origin } = await listen();
    expect(
      (await postEvent(origin, { ...validBody(), source: "" })).status,
    ).toBe(400);
    expect(
      (
        await postEvent(origin, {
          ...validBody(),
          source: "x".repeat(WORKFLOW_EVENT_SOURCE_MAX_LENGTH + 1),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await postEvent(origin, {
          ...validBody(),
          eventType: "x".repeat(WORKFLOW_EVENT_TYPE_MAX_LENGTH + 1),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await postEvent(origin, {
          ...validBody(),
          correlationKey: "x".repeat(
            WORKFLOW_EVENT_CORRELATION_KEY_MAX_LENGTH + 1,
          ),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await postEvent(origin, {
          ...validBody(),
          idempotencyKey: "x".repeat(
            WORKFLOW_EVENT_IDEMPOTENCY_KEY_MAX_LENGTH + 1,
          ),
        })
      ).status,
    ).toBe(400);
  });

  it("rejects oversized request bodies", async () => {
    const { origin, authHeaders } = await listen();
    const padding = "x".repeat(WORKFLOW_EVENT_HTTP_REQUEST_MAX_BYTES);
    const raw = JSON.stringify({
      ...validBody(),
      payload: { padding },
    });
    expect(Buffer.byteLength(raw, "utf8")).toBeGreaterThan(
      WORKFLOW_EVENT_HTTP_REQUEST_MAX_BYTES,
    );
    const response = await fetch(`${origin}/v1/workflow-events`, {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": "application/json",
      },
      body: raw,
    });
    expect(response.status).toBe(413);
  });

  it("returns equivalent idempotent retries with stable id and receivedAt", async () => {
    const { origin } = await listen();
    const body = validBody();
    const first = await postEvent(origin, body);
    const second = await postEvent(origin, body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("returns 409 on conflicting idempotent retries", async () => {
    const { origin } = await listen();
    const base = validBody();
    await postEvent(origin, base);
    const conflict = await postEvent(origin, {
      ...base,
      payload: { different: true },
    });
    expect(conflict.status).toBe(409);
  });

  it("keeps idempotency scoped per source and preserves exact case", async () => {
    const { origin } = await listen();
    const sharedKey = "idem-shared";
    const first = await postEvent(origin, {
      ...validBody(),
      source: "billing",
      idempotencyKey: sharedKey,
    });
    const second = await postEvent(origin, {
      ...validBody(),
      source: "Billing",
      idempotencyKey: sharedKey,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((second.body as { id: string }).id).not.toBe(
      (first.body as { id: string }).id,
    );
    expect((first.body as { source: string }).source).toBe("billing");
    expect((second.body as { source: string }).source).toBe("Billing");
  });

  async function listen() {
    const created = await createTestWebApplication({
      workspaceId: WORKSPACE_ID,
    });
    servers.push(created.server);
    const port = await listenHttpServer(created.server, "127.0.0.1", 0);
    setTestAuthHeaders(created.testApiKey);
    return {
      origin: `http://127.0.0.1:${String(port)}`,
      authHeaders: authHeadersForKey(created.testApiKey),
    };
  }
});

function validBody() {
  return {
    source: "Payments",
    eventType: "invoice.Paid",
    correlationKey: "ord-1",
    idempotencyKey: "idem-1",
    payload: { ok: true },
  };
}

async function postEvent(
  origin: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  return fetchJson(`${origin}/v1/workflow-events`, {
    method: "POST",
    body,
  });
}
