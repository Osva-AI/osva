import type { WorkspaceId } from "@osva/contracts";
import type { Workspace, WorkspaceRepository } from "@osva/domain";
import { count, eq } from "drizzle-orm";

import type { Database } from "../database.js";
import {
  workspaceFromRow,
  workspaceToRow,
} from "../mappers/workspace-mapper.js";
import { withMappedDatabaseErrors } from "../postgres-errors.js";
import { workspaces } from "../schema/workspaces.js";

export class PostgresWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly database: Database) {}

  async save(workspace: Workspace): Promise<void> {
    const row = workspaceToRow(workspace);

    await withMappedDatabaseErrors(() =>
      this.database.db
        .insert(workspaces)
        .values(row)
        .onConflictDoUpdate({
          target: workspaces.id,
          set: {
            name: row.name,
            createdAt: row.createdAt,
          },
        }),
    );
  }

  async findById(id: WorkspaceId): Promise<Workspace | null> {
    const [row] = await this.database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, id))
      .limit(1);

    return row === undefined ? null : workspaceFromRow(row);
  }

  async countAll(): Promise<number> {
    const [row] = await this.database.db
      .select({ value: count() })
      .from(workspaces);

    return Number(row?.value ?? 0);
  }

  async listIds(): Promise<readonly WorkspaceId[]> {
    const rows = await this.database.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .orderBy(workspaces.id);

    return rows.map((row) => row.id as WorkspaceId);
  }
}
