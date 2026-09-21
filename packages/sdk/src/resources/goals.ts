import type { GoalId } from "@osva/contracts";
import {
  createGoalRequestSchema,
  goalListResourceSchema,
  goalResourceSchema,
  updateGoalRequestSchema,
} from "@osva/contracts/schemas";
import type { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

type GoalResource = z.infer<typeof goalResourceSchema>;
type GoalListResource = z.infer<typeof goalListResourceSchema>;
type CreateGoalRequest = z.infer<typeof createGoalRequestSchema>;
type UpdateGoalRequest = z.infer<typeof updateGoalRequestSchema>;

export class GoalsResource {
  constructor(private readonly client: OsvaHttpClient) {}

  list(): Promise<GoalListResource> {
    return this.client.request({
      method: "GET",
      path: "/v1/goals",
    });
  }

  get(goalId: GoalId): Promise<GoalResource> {
    return this.client.request({
      method: "GET",
      path: `/v1/goals/${encodeURIComponent(goalId)}`,
    });
  }

  create(input: CreateGoalRequest): Promise<GoalResource> {
    return this.client.request({
      method: "POST",
      path: "/v1/goals",
      body: input,
    });
  }

  update(goalId: GoalId, input: UpdateGoalRequest): Promise<GoalResource> {
    return this.client.request({
      method: "PATCH",
      path: `/v1/goals/${encodeURIComponent(goalId)}`,
      body: input,
    });
  }
}
