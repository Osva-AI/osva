import type { JsonValue, WorkflowEventId, WorkspaceId } from "@osva/contracts";
import {
  DomainInvariantError,
  WorkflowEvent,
  WorkflowEventIdempotencyConflictError,
  Workspace,
} from "@osva/domain";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresWorkflowEventRepository } from "../../src/repositories/postgres-workflow-event-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { createIds, NOW } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

const eventId = "we-1" as WorkflowEventId;
const otherEventId = "we-2" as WorkflowEventId;
const receivedAt = new Date("2026-01-01T12:00:00.000Z");
const laterReceivedAt = new Date("2026-01-01T12:00:01.000Z");
const occurredAfterReceived = new Date("2026-01-01T12:00:05.000Z");
const payload: JsonValue = { a: 1, nested: { b: 2 } };

describe("PostgreSQL WorkflowEvent repository", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let events: PostgresWorkflowEventRepository;
  let workspaceId: WorkspaceId;
  let otherWorkspaceId: WorkspaceId;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    workspaces = new PostgresWorkspaceRepository(database);
    events = new PostgresWorkflowEventRepository(database);
    workspaceId = createIds("events-main").workspaceId;
    otherWorkspaceId = createIds("events-other").workspaceId;
  });

  afterAll(async () => {
    if (database) {
      await database.close();
    }
    if (context) {
      await stopPostgresForTests(context);
    }
  });

  beforeEach(async () => {
    await resetStage0Tables(database);
    await workspaces.save(
      Workspace.create({
        id: workspaceId,
        name: "Main",
        createdAt: NOW,
      }),
    );
    await workspaces.save(
      Workspace.create({
        id: otherWorkspaceId,
        name: "Other",
        createdAt: NOW,
      }),
    );
  });

  it("saves and reloads by WorkflowEventId", async () => {
    const created = createEvent();
    await events.saveWorkflowEvent(created);

    const loaded = await events.findWorkflowEventById(eventId);
    expect(loaded).not.toBeNull();
    expect(loaded!.source).toBe("payments");
    expect(loaded!.payload).toEqual(payload);
  });

  it("preserves payload on round-trip", async () => {
    await events.saveWorkflowEvent(createEvent());
    const loaded = await events.findWorkflowEventById(eventId);
    expect(loaded!.payload).toEqual(payload);
  });

  it("allows optional occurredAt", async () => {
    await events.saveWorkflowEvent(createEvent());
    const loaded = await events.findWorkflowEventById(eventId);
    expect(loaded?.occurredAt).toBeUndefined();
  });

  it("allows occurredAt after receivedAt", async () => {
    await events.saveWorkflowEvent(
      createEvent({ occurredAt: occurredAfterReceived }),
    );
    const loaded = await events.findWorkflowEventById(eventId);
    expect(loaded?.occurredAt?.toISOString()).toBe(
      occurredAfterReceived.toISOString(),
    );
  });

  it("finds by ingestion identity", async () => {
    await events.saveWorkflowEvent(createEvent());
    expect(
      await events.findWorkflowEventByIngestionIdentity(
        workspaceId,
        "payments",
        "idem-1",
      ),
    ).not.toBeNull();
  });

  it("returns the original persisted event on equivalent retry", async () => {
    const created = createEvent();
    await events.saveWorkflowEvent(created);

    const retried = await events.saveWorkflowEvent(
      createEvent({
        id: otherEventId,
        receivedAt: laterReceivedAt,
      }),
    );

    expect(retried.id).toBe(eventId);
    expect(retried.receivedAt).toEqual(receivedAt);
    expect(await events.findWorkflowEventById(otherEventId)).toBeNull();
  });

  it("throws WorkflowEventIdempotencyConflictError on conflicting retry", async () => {
    await events.saveWorkflowEvent(createEvent());

    await expect(
      events.saveWorkflowEvent(
        createEvent({
          id: otherEventId,
          eventType: "payment.failed",
        }),
      ),
    ).rejects.toBeInstanceOf(WorkflowEventIdempotencyConflictError);
  });

  it("scopes idempotency by source", async () => {
    await events.saveWorkflowEvent(createEvent());
    const otherSource = await events.saveWorkflowEvent(
      createEvent({
        id: otherEventId,
        source: "ledger",
      }),
    );
    expect(otherSource.id).toBe(otherEventId);
  });

  it("scopes idempotency by workspace", async () => {
    await events.saveWorkflowEvent(createEvent());
    const otherWorkspace = await events.saveWorkflowEvent(
      createEvent({
        id: otherEventId,
        workspaceId: otherWorkspaceId,
      }),
    );
    expect(otherWorkspace.workspaceId).toBe(otherWorkspaceId);
  });

  it("rejects duplicate WorkflowEventId under a different ingestion identity", async () => {
    await events.saveWorkflowEvent(createEvent());

    await expect(
      events.saveWorkflowEvent(
        createEvent({
          source: "ledger",
          idempotencyKey: "idem-ledger",
        }),
      ),
    ).rejects.toBeInstanceOf(DomainInvariantError);
  });

  it("does not collide ingestion keys that share delimiter-like prefixes", async () => {
    await events.saveWorkflowEvent(
      createEvent({
        id: eventId,
        source: "a:b",
        idempotencyKey: "c",
      }),
    );

    const independent = await events.saveWorkflowEvent(
      createEvent({
        id: otherEventId,
        source: "a",
        idempotencyKey: "b:c",
      }),
    );
    expect(independent.id).toBe(otherEventId);
  });

  it("concurrent equivalent inserts yield one canonical persisted event", async () => {
    const first = createEvent({ id: eventId });
    const second = createEvent({
      id: otherEventId,
      receivedAt: laterReceivedAt,
    });

    const results = await Promise.all([
      events.saveWorkflowEvent(first),
      events.saveWorkflowEvent(second),
    ]);

    expect(results[0]!.id).toBe(eventId);
    expect(results[1]!.id).toBe(eventId);
    expect(results[0]!.receivedAt).toEqual(receivedAt);
    expect(results[1]!.receivedAt).toEqual(receivedAt);

    const rows = await database.sql<{ count: string }[]>`
      select count(*)::text as count from workflow_events
      where workspace_id = ${workspaceId}
        and source = 'payments'
        and idempotency_key = 'idem-1'
    `;
    expect(rows[0]!.count).toBe("1");
  });

  function createEvent(
    overrides: Partial<Parameters<typeof WorkflowEvent.create>[0]> = {},
  ): WorkflowEvent {
    return WorkflowEvent.create({
      id: eventId,
      workspaceId,
      source: "payments",
      eventType: "payment.completed",
      correlationKey: "order_123",
      idempotencyKey: "idem-1",
      payload,
      receivedAt,
      ...overrides,
    });
  }
});
