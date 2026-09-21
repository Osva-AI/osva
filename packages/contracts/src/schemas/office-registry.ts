import { z } from "zod";

import { jsonValueSchema } from "./json-value.js";
import {
  agentIdSchema,
  assignmentIdSchema,
  goalIdSchema,
  officeWorkerIdSchema,
  roleIdSchema,
  runIdSchema,
  teamIdSchema,
  workflowRunIdSchema,
  workspaceIdSchema,
} from "./ids.js";

export const goalStateSchema = z.enum([
  "OPEN",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
]);

export const assignmentStateSchema = z.enum([
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const assignmentTargetTypeSchema = z.enum([
  "AGENT_VERSION",
  "WORKFLOW_VERSION",
]);

export const createOfficeWorkerRequestSchema = z.strictObject({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  agentId: agentIdSchema,
});

export const updateOfficeWorkerRequestSchema = z
  .strictObject({
    name: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
    {
      message: "At least one field must be provided.",
    },
  );

export const officeWorkerResourceSchema = z.strictObject({
  id: officeWorkerIdSchema,
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  agentId: agentIdSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const officeWorkerListResourceSchema = z.strictObject({
  items: z.array(officeWorkerResourceSchema),
});

export const createRoleRequestSchema = z.strictObject({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
});

export const updateRoleRequestSchema = z
  .strictObject({
    name: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
    {
      message: "At least one field must be provided.",
    },
  );

export const roleResourceSchema = z.strictObject({
  id: roleIdSchema,
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const roleListResourceSchema = z.strictObject({
  items: z.array(roleResourceSchema),
});

export const createTeamRequestSchema = z.strictObject({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
});

export const updateTeamRequestSchema = z
  .strictObject({
    name: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
    {
      message: "At least one field must be provided.",
    },
  );

export const teamResourceSchema = z.strictObject({
  id: teamIdSchema,
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const teamListResourceSchema = z.strictObject({
  items: z.array(teamResourceSchema),
});

export const teamMembershipResourceSchema = z.strictObject({
  teamId: teamIdSchema,
  officeWorkerId: officeWorkerIdSchema,
  roleId: roleIdSchema.optional(),
});

export const teamMembershipListResourceSchema = z.strictObject({
  items: z.array(teamMembershipResourceSchema),
});

export const addTeamMembershipRequestSchema = z.strictObject({
  officeWorkerId: officeWorkerIdSchema,
  roleId: roleIdSchema.optional(),
});

export const createGoalRequestSchema = z.strictObject({
  key: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1).optional(),
});

export const updateGoalRequestSchema = z
  .strictObject({
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    status: goalStateSchema.optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.status !== undefined,
    { message: "At least one field must be provided." },
  );

export const goalResourceSchema = z.strictObject({
  id: goalIdSchema,
  workspaceId: workspaceIdSchema,
  key: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  status: goalStateSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const goalListResourceSchema = z.strictObject({
  items: z.array(goalResourceSchema),
});

export const createAssignmentRequestSchema = z.strictObject({
  goalId: goalIdSchema.optional(),
  officeWorkerId: officeWorkerIdSchema,
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  targetType: assignmentTargetTypeSchema,
  targetVersionId: z.string().min(1),
  input: jsonValueSchema,
});

export const updateAssignmentRequestSchema = z
  .strictObject({
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    goalId: goalIdSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.goalId !== undefined,
    { message: "At least one field must be provided." },
  );

export const assignmentResourceSchema = z.strictObject({
  id: assignmentIdSchema,
  workspaceId: workspaceIdSchema,
  goalId: goalIdSchema.optional(),
  officeWorkerId: officeWorkerIdSchema,
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  targetType: assignmentTargetTypeSchema,
  targetVersionId: z.string().min(1),
  input: jsonValueSchema,
  status: assignmentStateSchema,
  runId: runIdSchema.optional(),
  workflowRunId: workflowRunIdSchema.optional(),
  createdAt: z.string().min(1),
  startedAt: z.string().min(1).optional(),
  completedAt: z.string().min(1).optional(),
  cancelledAt: z.string().min(1).optional(),
});

export const assignmentListResourceSchema = z.strictObject({
  items: z.array(assignmentResourceSchema),
});

export const listOfficeResourcesQuerySchema = z.strictObject({});
