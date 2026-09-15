import type { WorkspaceId } from "@osva/contracts";
import {
  MemoryAgentRepository,
  MemoryJobQueue,
  MemoryModelProfileRepository,
  MemoryRunRepository,
  MemoryWorkspaceRepository,
} from "@osva/adapters-memory";
import {
  Workspace,
  createAgentApplication,
  createModelProfileApplication,
  createRunApplication,
} from "@osva/domain";
import { CreateRun } from "@osva/orchestration";

import { createWebApplication } from "../src/http.js";
import type { RunHttpServices } from "../src/run-http.js";

export const TEST_NOW = new Date("2026-01-15T12:00:00.000Z");

export async function createTestWebApplication(options?: {
  readonly readinessCheck?: () => Promise<boolean>;
  readonly workspaceId?: WorkspaceId;
  readonly idPrefix?: string;
}) {
  const workspaces = new MemoryWorkspaceRepository();
  const agents = new MemoryAgentRepository();
  const modelProfiles = new MemoryModelProfileRepository();
  const runs = new MemoryRunRepository();
  const queue = new MemoryJobQueue();
  const clock = { now: () => TEST_NOW };
  let counter = 0;
  const prefix = options?.idPrefix ?? "id";
  const ids = {
    createId() {
      counter += 1;
      return `${prefix}-${String(counter)}`;
    },
  };

  if (options?.workspaceId !== undefined) {
    await workspaces.save(
      Workspace.create({
        id: options.workspaceId,
        name: "Workspace",
        createdAt: TEST_NOW,
      }),
    );
  }

  const runServices: RunHttpServices = {
    runs: createRunApplication({ runs }),
    createRun: new CreateRun({ runs, agents, queue }),
    clock,
    ids,
  };

  const server = createWebApplication({
    readinessCheck: options?.readinessCheck ?? (async () => true),
    agents: createAgentApplication({
      agents,
      workspaces,
      modelProfiles,
      clock,
      ids,
    }),
    modelProfiles: createModelProfileApplication({
      modelProfiles,
      workspaces,
      clock,
      ids,
    }),
    runs: runServices,
  });

  return { server, workspaces, agents, modelProfiles, runs, queue };
}
