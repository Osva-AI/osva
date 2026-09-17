import type {
  AgentVersionId,
  AssignmentId,
  GoalId,
  OfficeWorkerId,
  RoleId,
  RunId,
  TeamId,
  WorkflowRunId,
  WorkflowVersionId,
  WorkspaceId,
} from "./ids.js";
import type { JsonValue } from "./json-value.js";
import type {
  AssignmentState,
  AssignmentTargetType,
  GoalState,
} from "./office-state.js";

export interface OfficeWorkerResourceV1 {
  readonly id: OfficeWorkerId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly agentId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OfficeWorkerListResourceV1 {
  readonly items: readonly OfficeWorkerResourceV1[];
}

export interface CreateOfficeWorkerRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly agentId: string;
}

export interface UpdateOfficeWorkerRequestV1 {
  readonly name?: string;
  readonly description?: string;
}

export interface RoleResourceV1 {
  readonly id: RoleId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RoleListResourceV1 {
  readonly items: readonly RoleResourceV1[];
}

export interface CreateRoleRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export interface UpdateRoleRequestV1 {
  readonly name?: string;
  readonly description?: string;
}

export interface TeamResourceV1 {
  readonly id: TeamId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TeamListResourceV1 {
  readonly items: readonly TeamResourceV1[];
}

export interface CreateTeamRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export interface UpdateTeamRequestV1 {
  readonly name?: string;
  readonly description?: string;
}

export interface TeamMembershipResourceV1 {
  readonly teamId: TeamId;
  readonly officeWorkerId: OfficeWorkerId;
  readonly roleId?: RoleId;
}

export interface TeamMembershipListResourceV1 {
  readonly items: readonly TeamMembershipResourceV1[];
}

export interface AddTeamMembershipRequestV1 {
  readonly officeWorkerId: OfficeWorkerId;
  readonly roleId?: RoleId;
}

export interface GoalResourceV1 {
  readonly id: GoalId;
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly title: string;
  readonly description?: string;
  readonly status: GoalState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GoalListResourceV1 {
  readonly items: readonly GoalResourceV1[];
}

export interface CreateGoalRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly key: string;
  readonly title: string;
  readonly description?: string;
}

export interface UpdateGoalRequestV1 {
  readonly title?: string;
  readonly description?: string;
  readonly status?: GoalState;
}

export interface AssignmentResourceV1 {
  readonly id: AssignmentId;
  readonly workspaceId: WorkspaceId;
  readonly goalId?: GoalId;
  readonly officeWorkerId: OfficeWorkerId;
  readonly title: string;
  readonly description?: string;
  readonly targetType: AssignmentTargetType;
  readonly targetVersionId: string;
  readonly input: JsonValue;
  readonly status: AssignmentState;
  readonly runId?: RunId;
  readonly workflowRunId?: WorkflowRunId;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly cancelledAt?: string;
}

export interface AssignmentListResourceV1 {
  readonly items: readonly AssignmentResourceV1[];
}

export interface CreateAssignmentRequestV1 {
  readonly workspaceId: WorkspaceId;
  readonly goalId?: GoalId;
  readonly officeWorkerId: OfficeWorkerId;
  readonly title: string;
  readonly description?: string;
  readonly targetType: AssignmentTargetType;
  readonly targetVersionId: AgentVersionId | WorkflowVersionId | string;
  readonly input: JsonValue;
}

export interface UpdateAssignmentRequestV1 {
  readonly title?: string;
  readonly description?: string;
  readonly goalId?: GoalId | null;
}
