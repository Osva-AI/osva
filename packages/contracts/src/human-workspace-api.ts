import { z } from "zod";

export const createOrganizationWorkspaceRequestSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1).max(128),
});

export type CreateOrganizationWorkspaceRequestV1 = z.infer<
  typeof createOrganizationWorkspaceRequestSchema
>;

export const renameWorkspaceRequestSchema = z.object({
  name: z.string().min(1).max(128),
});

export type RenameWorkspaceRequestV1 = z.infer<
  typeof renameWorkspaceRequestSchema
>;
