import type { RoleId, WorkspaceId } from "@osva/contracts";
import {
  createRoleRequestSchema,
  roleListResourceSchema,
  roleResourceSchema,
  updateRoleRequestSchema,
} from "@osva/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type RoleResource = z.infer<typeof roleResourceSchema>;
type RoleListResource = z.infer<typeof roleListResourceSchema>;
type CreateRoleRequest = z.infer<typeof createRoleRequestSchema>;
type UpdateRoleRequest = z.infer<typeof updateRoleRequestSchema>;

export class RolesResource {
  constructor(private readonly client: OsvaHttpClient) {}

  list(workspaceId: WorkspaceId): Promise<RoleListResource> {
    return this.client.request({
      method: "GET",
      path: "/v1/roles",
      query: { workspaceId },
    });
  }

  get(roleId: RoleId): Promise<RoleResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/roles/${encodeURIComponent(roleId)}`,
    });
  }

  create(input: CreateRoleRequest): Promise<RoleResource> {
    return this.client.request({
      method: "POST",
      path: "/v1/roles",
      body: input,
    });
  }

  update(roleId: RoleId, input: UpdateRoleRequest): Promise<RoleResource> {
    return this.client.request({
      method: "PATCH",
      path: `/v1/roles/${encodeURIComponent(roleId)}`,
      body: input,
    });
  }
}
