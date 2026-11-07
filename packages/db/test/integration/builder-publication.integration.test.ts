import type {
  ModelProfileId,
  ModelProfileVersionId,
  WorkspaceId,
} from "@osva-ai/contracts";
import {
  PrepareBuilderPublication,
  PublishBuilderProposal,
  GetBuilderPublicationReceipt,
  GetWorkspaceBuilderCapabilityCatalog,
} from "@osva/domain/builder";
import {
  BuilderPublicationIdempotencyConflictError,
  Workspace,
  ModelProfile,
  ModelProfileVersion,
} from "@osva/domain";
import {
  fakeControlPlaneScope,
  publicationProposalFor,
} from "./builder-publication-proposal-fixtures.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../src/database.js";
import { migrateDatabase } from "../../src/migrate.js";
import { PostgresAgentRepository } from "../../src/repositories/postgres-agent-repository.js";
import { PostgresBuilderPublicationRepository } from "../../src/repositories/postgres-builder-publication-repository.js";
import { PostgresModelProfileRepository } from "../../src/repositories/postgres-model-profile-repository.js";
import { PostgresToolRepository } from "../../src/repositories/postgres-tool-repository.js";
import { PostgresWorkflowRepository } from "../../src/repositories/postgres-workflow-repository.js";
import { PostgresWorkspaceRepository } from "../../src/repositories/postgres-workspace-repository.js";
import { PostgresKnowledgeRepository } from "../../src/repositories/postgres-knowledge-repository.js";
import { PostgresMemoryNamespaceRepository } from "../../src/repositories/postgres-memory-namespace-repository.js";
import { NOW } from "./fixtures.js";
import {
  resetStage0Tables,
  startPostgresForTests,
  stopPostgresForTests,
  type PostgresTestContext,
} from "./postgres-harness.js";

interface PublicationFixture {
  readonly scope: ReturnType<typeof fakeControlPlaneScope>;
  readonly prepare: PrepareBuilderPublication;
  readonly createPublish: () => PublishBuilderProposal;
  readonly publications: PostgresBuilderPublicationRepository;
  readonly agents: PostgresAgentRepository;
  readonly workflows: PostgresWorkflowRepository;
  readonly database: Database;
  readonly mpvId: ModelProfileVersionId;
}

async function seedWorkspaceModel(
  workspaces: PostgresWorkspaceRepository,
  modelProfiles: PostgresModelProfileRepository,
  workspaceId: WorkspaceId,
  mpvSuffix: string,
): Promise<ModelProfileVersionId> {
  await workspaces.save(
    Workspace.create({
      id: workspaceId,
      name: `WS ${workspaceId}`,
      createdAt: NOW,
    }),
  );
  const mp = ModelProfile.create({
    id: `mp-${mpvSuffix}` as ModelProfileId,
    workspaceId,
    key: "default",
    name: "Default",
    createdAt: NOW,
  });
  await modelProfiles.saveModelProfile(mp);
  const mpv = ModelProfileVersion.create({
    id: `mpv-${mpvSuffix}` as ModelProfileVersionId,
    modelProfileId: mp.id,
    version: 1,
    provider: "OPENAI",
    model: "gpt-test",
    createdAt: NOW,
  });
  await modelProfiles.saveModelProfileVersion(mpv);
  return mpv.id;
}

function buildFixture(
  database: Database,
  workspaceId: WorkspaceId,
  mpvId: ModelProfileVersionId,
  idStream: { next: () => string },
): PublicationFixture {
  const workspaces = new PostgresWorkspaceRepository(database);
  const agents = new PostgresAgentRepository(database);
  const workflows = new PostgresWorkflowRepository(database);
  const modelProfiles = new PostgresModelProfileRepository(database);
  const tools = new PostgresToolRepository(database);
  const publications = new PostgresBuilderPublicationRepository(database);
  const memoryNamespaces = new PostgresMemoryNamespaceRepository(database);
  const knowledge = new PostgresKnowledgeRepository(database);

  const getCatalog = new GetWorkspaceBuilderCapabilityCatalog({
    workspaces,
    agents,
    modelProfiles,
    tools,
  });

  const prepare = new PrepareBuilderPublication({
    getCatalog,
    agents,
    workflows,
  });

  const createPublish = () =>
    new PublishBuilderProposal({
      getCatalog,
      agents,
      workflows,
      workspaces,
      modelProfiles,
      tools,
      memoryNamespaces,
      knowledge,
      publications,
      clock: { now: () => NOW },
      ids: { createId: () => idStream.next() },
    });

  return {
    scope: fakeControlPlaneScope(workspaceId),
    prepare,
    createPublish,
    publications,
    agents,
    workflows,
    database,
    mpvId,
  };
}

function proposalFor(workspaceKey: string, mpvId: ModelProfileVersionId) {
  return publicationProposalFor(workspaceKey, mpvId);
}

describe("PostgreSQL builder publication (M20.4)", () => {
  let context: PostgresTestContext;
  let database: Database;
  let workspaces: PostgresWorkspaceRepository;
  let modelProfiles: PostgresModelProfileRepository;

  const workspaceId = "ws-bpub-int" as WorkspaceId;
  let mpvId: ModelProfileVersionId;
  let seq = 0;

  beforeAll(async () => {
    context = await startPostgresForTests();
    database = createDatabase({
      connectionString: context.connectionString,
      max: 5,
      connectTimeoutSeconds: 10,
    });
    await migrateDatabase(database);
    workspaces = new PostgresWorkspaceRepository(database);
    modelProfiles = new PostgresModelProfileRepository(database);
  });

  afterAll(async () => {
    await database?.close();
    await stopPostgresForTests(context);
  });

  beforeEach(async () => {
    seq = 0;
    await resetStage0Tables(database);
    mpvId = await seedWorkspaceModel(
      workspaces,
      modelProfiles,
      workspaceId,
      "bpub",
    );
  });

  function fixture(): PublicationFixture {
    return buildFixture(database, workspaceId, mpvId, {
      next: () => `bpub-id-${String((seq += 1))}`,
    });
  }

  it("commits agents, workflow version, publication receipt, and audit atomically", async () => {
    const f = fixture();
    const proposal = proposalFor("atomic", mpvId);
    const plan = await f.prepare.execute({
      scope: f.scope,
      proposalUnknown: proposal,
    });
    const out = await f.createPublish().execute({
      scope: f.scope,
      proposalUnknown: proposal,
      expectedPlanDigest: plan.planDigest,
      idempotencyKey: "atomic-key-1",
    });

    expect(out.receipt.state).toBe("SUCCEEDED");
    const wf = await f.workflows.findWorkflowByWorkspaceAndId(
      workspaceId,
      out.receipt.workflowId!,
    );
    expect(wf?.key).toBe("atomic-wf");

    const auditRows = await f.database.sql`
      SELECT event_type FROM security_audit_events
      WHERE workspace_id = ${workspaceId}
    `;
    expect(
      auditRows.some((r) => r.event_type === "builder.publication_succeeded"),
    ).toBe(true);
    const pubRows = await f.database.sql`
      SELECT id FROM builder_publications WHERE workspace_id = ${workspaceId}
    `;
    expect(pubRows.length).toBe(1);
  });

  const rollbackCases = [
    {
      label: "after agent insert",
      key: "rb-agent",
      hook: {
        afterNewAgentsPersisted: async () => {
          throw new Error("fail after agent");
        },
      },
    },
    {
      label: "after agent version insert",
      key: "rb-av",
      hook: {
        afterNewAgentVersionsPersisted: async () => {
          throw new Error("fail after agent version");
        },
      },
    },
    {
      label: "before workflow version path",
      key: "rb-wf",
      hook: {
        beforeWorkflowPersisted: async () => {
          throw new Error("fail before workflow");
        },
      },
    },
    {
      label: "before receipt insert",
      key: "rb-rcpt",
      hook: {
        beforeReceiptPersisted: async () => {
          throw new Error("fail before receipt");
        },
      },
    },
    {
      label: "before audit insert",
      key: "rb-audit",
      hook: {
        beforeAuditPersisted: async () => {
          throw new Error("fail before audit");
        },
      },
    },
  ] as const;

  it.each(rollbackCases)(
    "rolls back entire publication when $label",
    async ({ key, hook }) => {
      const f = fixture();
      const proposal = proposalFor(key, mpvId);
      const plan = await f.prepare.execute({
        scope: f.scope,
        proposalUnknown: proposal,
      });
      await expect(
        f.createPublish().execute({
          scope: f.scope,
          proposalUnknown: proposal,
          expectedPlanDigest: plan.planDigest,
          idempotencyKey: `idem-${key}`,
          testHooks: hook,
        }),
      ).rejects.toThrow();

      expect(await f.agents.listAgentsByWorkspaceId(workspaceId)).toHaveLength(
        0,
      );
      expect(
        await f.workflows.listWorkflowsByWorkspaceId(workspaceId),
      ).toHaveLength(0);
      const pubs = await f.database.sql`
        SELECT id FROM builder_publications WHERE workspace_id = ${workspaceId}
      `;
      expect(pubs.length).toBe(0);
    },
  );

  it("allows a safe retry after a rolled-back failure", async () => {
    const f = fixture();
    const proposal = proposalFor("retry", mpvId);
    const plan = await f.prepare.execute({
      scope: f.scope,
      proposalUnknown: proposal,
    });
    const publish = f.createPublish();
    await expect(
      publish.execute({
        scope: f.scope,
        proposalUnknown: proposal,
        expectedPlanDigest: plan.planDigest,
        idempotencyKey: "retry-key",
        testHooks: {
          beforeAuditPersisted: async () => {
            throw new Error("injected");
          },
        },
      }),
    ).rejects.toThrow("injected");

    const success = await publish.execute({
      scope: f.scope,
      proposalUnknown: proposal,
      expectedPlanDigest: plan.planDigest,
      idempotencyKey: "retry-key",
    });
    expect(success.replay).toBe(false);
    expect(success.receipt.workflowId).toBeDefined();
  });

  it("replays lost HTTP responses without duplicate resources", async () => {
    const f = fixture();
    const proposal = proposalFor("lost", mpvId);
    const plan = await f.prepare.execute({
      scope: f.scope,
      proposalUnknown: proposal,
    });
    const publish = f.createPublish();
    const first = await publish.execute({
      scope: f.scope,
      proposalUnknown: proposal,
      expectedPlanDigest: plan.planDigest,
      idempotencyKey: "lost-response",
    });
    const second = await publish.execute({
      scope: f.scope,
      proposalUnknown: proposal,
      expectedPlanDigest: plan.planDigest,
      idempotencyKey: "lost-response",
    });
    expect(first.replay).toBe(false);
    expect(second.replay).toBe(true);
    expect(second.receipt.workflowId).toBe(first.receipt.workflowId);
    expect(await f.agents.listAgentsByWorkspaceId(workspaceId)).toHaveLength(1);
    expect(
      await f.workflows.listWorkflowsByWorkspaceId(workspaceId),
    ).toHaveLength(1);
  });

  it("rejects same idempotency key with different plan digest", async () => {
    const f = fixture();
    const proposalA = proposalFor("conf-a", mpvId);
    const planA = await f.prepare.execute({
      scope: f.scope,
      proposalUnknown: proposalA,
    });
    await f.createPublish().execute({
      scope: f.scope,
      proposalUnknown: proposalA,
      expectedPlanDigest: planA.planDigest,
      idempotencyKey: "shared-conflict",
    });

    const proposalB = proposalFor("conf-b", mpvId);
    const planB = await f.prepare.execute({
      scope: f.scope,
      proposalUnknown: proposalB,
    });
    await expect(
      f.createPublish().execute({
        scope: f.scope,
        proposalUnknown: proposalB,
        expectedPlanDigest: planB.planDigest,
        idempotencyKey: "shared-conflict",
      }),
    ).rejects.toBeInstanceOf(BuilderPublicationIdempotencyConflictError);
  });

  it("concurrent same-key publications commit once (separate DB connections)", async () => {
    const proposal = proposalFor("conc", mpvId);
    const db1 = createDatabase({
      connectionString: context.connectionString,
      max: 1,
      connectTimeoutSeconds: 10,
    });
    const db2 = createDatabase({
      connectionString: context.connectionString,
      max: 1,
      connectTimeoutSeconds: 10,
    });
    let seqA = 0;
    let seqB = 0;
    const f1 = buildFixture(db1, workspaceId, mpvId, {
      next: () => `conc-a-${String((seqA += 1))}`,
    });
    const f2 = buildFixture(db2, workspaceId, mpvId, {
      next: () => `conc-b-${String((seqB += 1))}`,
    });
    const plan = await f1.prepare.execute({
      scope: f1.scope,
      proposalUnknown: proposal,
    });

    const [r1, r2] = await Promise.all([
      f1.createPublish().execute({
        scope: f1.scope,
        proposalUnknown: proposal,
        expectedPlanDigest: plan.planDigest,
        idempotencyKey: "concurrent-1",
      }),
      f2.createPublish().execute({
        scope: f2.scope,
        proposalUnknown: proposal,
        expectedPlanDigest: plan.planDigest,
        idempotencyKey: "concurrent-1",
      }),
    ]);

    expect(r1.receipt.workflowId).toBe(r2.receipt.workflowId);
    expect(r1.replay !== r2.replay || r1.replay === r2.replay).toBe(true);
    expect([r1.replay, r2.replay].filter(Boolean).length).toBe(1);
    expect(await f1.agents.listAgentsByWorkspaceId(workspaceId)).toHaveLength(
      1,
    );
    expect(
      await f1.workflows.listWorkflowsByWorkspaceId(workspaceId),
    ).toHaveLength(1);

    await db1.close();
    await db2.close();
  });

  it("isolates publication receipts between workspaces", async () => {
    const otherWs = "ws-bpub-other" as WorkspaceId;
    const otherMpv = await seedWorkspaceModel(
      workspaces,
      modelProfiles,
      otherWs,
      "other",
    );
    const f1 = fixture();
    const f2 = buildFixture(database, otherWs, otherMpv, {
      next: () => `other-${String((seq += 1))}`,
    });

    const p1 = proposalFor("iso-a", mpvId);
    const plan1 = await f1.prepare.execute({
      scope: f1.scope,
      proposalUnknown: p1,
    });
    const published = await f1.createPublish().execute({
      scope: f1.scope,
      proposalUnknown: p1,
      expectedPlanDigest: plan1.planDigest,
      idempotencyKey: "iso-key",
    });

    const getReceipt = new GetBuilderPublicationReceipt(f2.publications);
    await expect(
      getReceipt.execute(f2.scope, published.receipt.id),
    ).rejects.toMatchObject({ name: "BuilderPublicationNotFoundError" });
  });
});
