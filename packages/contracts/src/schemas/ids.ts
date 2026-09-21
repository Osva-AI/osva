import { z } from "zod";

import type { OsvaId } from "../ids.js";

function osvaIdSchema<Name extends string>(): z.ZodType<OsvaId<Name>, string> {
  return z.string().min(1) as unknown as z.ZodType<OsvaId<Name>, string>;
}

export const workspaceIdSchema = osvaIdSchema<"WorkspaceId">();
export const apiKeyIdSchema = osvaIdSchema<"ApiKeyId">();
export const agentIdSchema = osvaIdSchema<"AgentId">();
export const agentVersionIdSchema = osvaIdSchema<"AgentVersionId">();
export const deploymentIdSchema = osvaIdSchema<"DeploymentId">();
export const runIdSchema = osvaIdSchema<"RunId">();
export const runAttemptIdSchema = osvaIdSchema<"RunAttemptId">();
export const runStepIdSchema = osvaIdSchema<"RunStepId">();
export const scheduleIdSchema = osvaIdSchema<"ScheduleId">();
export const scheduleOccurrenceIdSchema =
  osvaIdSchema<"ScheduleOccurrenceId">();
export const workflowIdSchema = osvaIdSchema<"WorkflowId">();
export const workflowVersionIdSchema = osvaIdSchema<"WorkflowVersionId">();
export const workflowRunIdSchema = osvaIdSchema<"WorkflowRunId">();
export const workflowNodeRunIdSchema = osvaIdSchema<"WorkflowNodeRunId">();
export const approvalRequestIdSchema = osvaIdSchema<"ApprovalRequestId">();
export const workflowEventIdSchema = osvaIdSchema<"WorkflowEventId">();
export const toolIdSchema = osvaIdSchema<"ToolId">();
export const toolVersionIdSchema = osvaIdSchema<"ToolVersionId">();
export const connectorIdSchema = osvaIdSchema<"ConnectorId">();
export const connectorVersionIdSchema = osvaIdSchema<"ConnectorVersionId">();
export const modelProfileIdSchema = osvaIdSchema<"ModelProfileId">();
export const modelProfileVersionIdSchema =
  osvaIdSchema<"ModelProfileVersionId">();
export const evaluationIdSchema = osvaIdSchema<"EvaluationId">();
export const memoryNamespaceIdSchema = osvaIdSchema<"MemoryNamespaceId">();
export const evaluationSuiteIdSchema = osvaIdSchema<"EvaluationSuiteId">();
export const evaluationSuiteVersionIdSchema =
  osvaIdSchema<"EvaluationSuiteVersionId">();
export const evaluationCaseIdSchema = osvaIdSchema<"EvaluationCaseId">();
export const evaluationRunIdSchema = osvaIdSchema<"EvaluationRunId">();
export const evaluationCaseResultIdSchema =
  osvaIdSchema<"EvaluationCaseResultId">();
export const artifactIdSchema = osvaIdSchema<"ArtifactId">();
export const eventIdSchema = osvaIdSchema<"EventId">();
export const officeWorkerIdSchema = osvaIdSchema<"OfficeWorkerId">();
export const roleIdSchema = osvaIdSchema<"RoleId">();
export const teamIdSchema = osvaIdSchema<"TeamId">();
export const goalIdSchema = osvaIdSchema<"GoalId">();
export const assignmentIdSchema = osvaIdSchema<"AssignmentId">();
export const knowledgeSourceIdSchema = osvaIdSchema<"KnowledgeSourceId">();
export const knowledgeIndexIdSchema = osvaIdSchema<"KnowledgeIndexId">();
export const knowledgeChunkIdSchema = osvaIdSchema<"KnowledgeChunkId">();
