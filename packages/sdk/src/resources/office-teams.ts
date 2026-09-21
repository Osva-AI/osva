import type { TeamId } from "@osva/contracts";
import {
  addTeamMembershipRequestSchema,
  createTeamRequestSchema,
  teamListResourceSchema,
  teamMembershipListResourceSchema,
  teamResourceSchema,
  updateTeamRequestSchema,
} from "@osva/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type TeamResource = z.infer<typeof teamResourceSchema>;
type TeamListResource = z.infer<typeof teamListResourceSchema>;
type TeamMembershipListResource = z.infer<
  typeof teamMembershipListResourceSchema
>;
type CreateTeamRequest = z.infer<typeof createTeamRequestSchema>;
type UpdateTeamRequest = z.infer<typeof updateTeamRequestSchema>;
type AddTeamMembershipRequest = z.infer<typeof addTeamMembershipRequestSchema>;

export class TeamsResource {
  constructor(private readonly client: OsvaHttpClient) {}

  list(): Promise<TeamListResource> {
    return this.client.request({
      method: "GET",
      path: "/v1/teams",
    });
  }

  get(teamId: TeamId): Promise<TeamResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/teams/${encodeURIComponent(teamId)}`,
    });
  }

  create(input: CreateTeamRequest): Promise<TeamResource> {
    return this.client.request({
      method: "POST",
      path: "/v1/teams",
      body: input,
    });
  }

  update(teamId: TeamId, input: UpdateTeamRequest): Promise<TeamResource> {
    return this.client.request({
      method: "PATCH",
      path: `/v1/teams/${encodeURIComponent(teamId)}`,
      body: input,
    });
  }

  listMemberships(teamId: TeamId): Promise<TeamMembershipListResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/teams/${encodeURIComponent(teamId)}/memberships`,
    });
  }

  addMembership(
    teamId: TeamId,
    input: AddTeamMembershipRequest,
  ): Promise<TeamMembershipListResource["items"][number]> {
    return this.client.request({
      method: "POST",
      path: `/v1/teams/${encodeURIComponent(teamId)}/memberships`,
      body: input,
    });
  }
}
