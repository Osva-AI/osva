import { foreignKey, pgTable, text, unique } from "drizzle-orm/pg-core";

import { officeWorkers } from "./office-workers.js";
import { roles } from "./roles.js";
import { teams } from "./teams.js";

export const teamMemberships = pgTable(
  "team_memberships",
  {
    teamId: text("team_id").notNull(),
    officeWorkerId: text("office_worker_id").notNull(),
    roleId: text("role_id"),
  },
  (table) => [
    unique("team_memberships_team_id_office_worker_id_unique").on(
      table.teamId,
      table.officeWorkerId,
    ),
    foreignKey({
      columns: [table.teamId],
      foreignColumns: [teams.id],
      name: "team_memberships_team_id_teams_fk",
    }),
    foreignKey({
      columns: [table.officeWorkerId],
      foreignColumns: [officeWorkers.id],
      name: "team_memberships_office_worker_id_office_workers_fk",
    }),
    foreignKey({
      columns: [table.roleId],
      foreignColumns: [roles.id],
      name: "team_memberships_role_id_roles_fk",
    }),
  ],
);
