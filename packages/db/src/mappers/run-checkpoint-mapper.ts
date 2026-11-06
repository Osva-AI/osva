import type {
  RunAttemptId,
  RunCheckpointRecordV1,
  RunId,
  WorkspaceId,
} from "@osva-ai/contracts";

import type { runCheckpoints } from "../schema/run-checkpoints.js";
import { toDomainDate } from "./timestamps.js";

type RunCheckpointRow = typeof runCheckpoints.$inferSelect;

export function runCheckpointFromRow(
  row: RunCheckpointRow,
): RunCheckpointRecordV1 {
  return {
    id: row.id,
    workspaceId: row.workspaceId as WorkspaceId,
    runId: row.runId as RunId,
    sequence: row.sequence,
    runAttemptId: row.runAttemptId as RunAttemptId,
    executionGeneration: row.executionGeneration,
    runtimeKind: "DECLARATIVE",
    envelopeVersion:
      row.envelopeVersion as RunCheckpointRecordV1["envelopeVersion"],
    stateSchemaVersion:
      row.stateSchemaVersion as RunCheckpointRecordV1["stateSchemaVersion"],
    bindingIdentity: row.bindingIdentity,
    bindingDigest: row.bindingDigest,
    cursor: row.cursor,
    state: row.state,
    payloadDigest: row.payloadDigest,
    createdAt: toDomainDate(row.createdAt).toISOString(),
  };
}
