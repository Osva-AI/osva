import { z } from "zod";

import { runAttemptIdSchema } from "./ids.js";

export const jobQueuePayloadSchema = z.strictObject({
  runAttemptId: runAttemptIdSchema,
});
