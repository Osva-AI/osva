import { z } from "zod";

import {
  RUN_LIVE_STREAM_STATUS_VALUES,
  RUN_LIVE_STREAM_VIEWER_FORMAT_VERSION,
} from "../run-live-stream.js";
import { runAttemptIdSchema, runIdSchema, workspaceIdSchema } from "./ids.js";

const viewerEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("TEXT_DELTA"),
    textDelta: z.string(),
  }),
  z.object({
    kind: z.literal("STREAM_STATUS"),
    status: z.enum(RUN_LIVE_STREAM_STATUS_VALUES),
    message: z.string().optional(),
  }),
]);

export const runLiveStreamViewerEnvelopeSchema = z.object({
  formatVersion: z.literal(RUN_LIVE_STREAM_VIEWER_FORMAT_VERSION),
  workspaceId: workspaceIdSchema,
  runId: runIdSchema,
  runAttemptId: runAttemptIdSchema,
  streamId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  emittedAt: z.string().min(1),
  viewerEvent: viewerEventSchema,
});

export type RunLiveStreamViewerEnvelopeValidated = z.infer<
  typeof runLiveStreamViewerEnvelopeSchema
>;
