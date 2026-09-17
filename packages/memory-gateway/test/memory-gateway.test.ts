import type {
  MemoryAuthorization,
  MemoryNamespaceId,
  WorkspaceId,
} from "@osva/contracts";
import { MEMORY_ERROR_CODES } from "@osva/contracts";
import { MemoryMemoryNamespaceRepository } from "@osva/adapters-memory";
import { Workspace, createMemoryApplication } from "@osva/domain";
import { describe, expect, it } from "vitest";

import { MemoryGateway, MemoryGatewayError } from "../src/index.js";

const NOW = new Date("2026-01-15T12:00:00.000Z");
const WORKSPACE_ID = "ws-1" as WorkspaceId;

describe("MemoryGateway", () => {
  it("gets, sets, lists, and deletes records through bindings", async () => {
    const { gateway, authorization, namespaceId } = await createGateway();

    const created = await gateway.set(
      { bindingName: "notes", key: "greeting", value: { text: "hello" } },
      authorization,
    );
    expect(created).toEqual({
      key: "greeting",
      value: { text: "hello" },
      revision: 1,
    });

    const fetched = await gateway.get(
      { bindingName: "notes", key: "greeting" },
      authorization,
    );
    expect(fetched.revision).toBe(1);

    const listed = await gateway.list({ bindingName: "notes" }, authorization);
    expect(listed.items).toHaveLength(1);

    await gateway.delete(
      { bindingName: "notes", key: "greeting", expectedRevision: 1 },
      authorization,
    );

    await expect(
      gateway.get({ bindingName: "notes", key: "greeting" }, authorization),
    ).rejects.toMatchObject({
      code: MEMORY_ERROR_CODES.MEMORY_KEY_NOT_FOUND,
    });

    void namespaceId;
  });

  it("denies write operations for read-only bindings", async () => {
    const { gateway, readOnlyAuthorization } = await createGateway({
      access: "READ_ONLY",
    });

    await expect(
      gateway.set(
        { bindingName: "notes", key: "greeting", value: { text: "hello" } },
        readOnlyAuthorization,
      ),
    ).rejects.toMatchObject({
      code: MEMORY_ERROR_CODES.MEMORY_PERMISSION_DENIED,
    });
  });

  it("denies persistent mutation when allowPersistentMutation is false", async () => {
    const { gateway, authorization } = await createGateway();

    await expect(
      gateway.set(
        { bindingName: "notes", key: "greeting", value: { text: "hello" } },
        { ...authorization, allowPersistentMutation: false },
      ),
    ).rejects.toMatchObject({
      code: MEMORY_ERROR_CODES.MEMORY_PERMISSION_DENIED,
    });
  });

  it("rejects bindings outside the authorized workspace", async () => {
    const { gateway, authorization, otherNamespaceId } = await createGateway();

    await expect(
      gateway.get(
        { bindingName: "notes", key: "missing" },
        {
          ...authorization,
          memoryNamespaceBindings: {
            notes: { namespaceId: otherNamespaceId, access: "READ_WRITE" },
          },
        },
      ),
    ).rejects.toMatchObject({
      code: MEMORY_ERROR_CODES.MEMORY_BINDING_NOT_FOUND,
    });
  });

  it("maps revision conflicts to MEMORY_CONFLICT", async () => {
    const { gateway, authorization } = await createGateway();

    await gateway.set(
      { bindingName: "notes", key: "counter", value: { count: 1 } },
      authorization,
    );

    await expect(
      gateway.set(
        {
          bindingName: "notes",
          key: "counter",
          value: { count: 2 },
          expectedRevision: 99,
        },
        authorization,
      ),
    ).rejects.toBeInstanceOf(MemoryGatewayError);

    await expect(
      gateway.set(
        {
          bindingName: "notes",
          key: "counter",
          value: { count: 2 },
          expectedRevision: 99,
        },
        authorization,
      ),
    ).rejects.toMatchObject({
      code: MEMORY_ERROR_CODES.MEMORY_CONFLICT,
    });
  });
});

async function createGateway(options?: {
  readonly access?: "READ_ONLY" | "READ_WRITE";
}) {
  const workspaces = {
    async findById(id: WorkspaceId) {
      return Workspace.create({
        id,
        name: `Workspace ${id}`,
        createdAt: NOW,
      });
    },
    async save() {},
  };
  const memoryNamespaces = new MemoryMemoryNamespaceRepository();
  let namespaceCounter = 0;
  const memoryApplication = createMemoryApplication({
    memoryNamespaces,
    workspaces,
    clock: { now: () => NOW },
    ids: {
      createId() {
        namespaceCounter += 1;
        return `namespace-${String(namespaceCounter)}`;
      },
    },
  });

  const namespace = await memoryApplication.createMemoryNamespace.execute({
    workspaceId: WORKSPACE_ID,
    key: "notes",
    name: "Notes",
  });
  const otherNamespace = await memoryApplication.createMemoryNamespace.execute({
    workspaceId: "ws-other" as WorkspaceId,
    key: "other",
    name: "Other",
  });

  const access = options?.access ?? "READ_WRITE";
  const authorization: MemoryAuthorization = {
    workspaceId: WORKSPACE_ID,
    allowPersistentMutation: true,
    memoryNamespaceBindings: {
      notes: {
        namespaceId: namespace.id,
        access,
      },
    },
  };

  return {
    gateway: new MemoryGateway({
      memoryNamespaces,
      clock: { now: () => NOW },
    }),
    authorization,
    readOnlyAuthorization: {
      ...authorization,
      memoryNamespaceBindings: {
        notes: {
          namespaceId: namespace.id,
          access: "READ_ONLY" as const,
        },
      },
    },
    namespaceId: namespace.id as MemoryNamespaceId,
    otherNamespaceId: otherNamespace.id as MemoryNamespaceId,
  };
}
