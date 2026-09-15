import { z } from "zod";

import type { JsonSchemaRecord } from "../json-schema.js";

export const jsonSchemaRecordSchema = z.record(
  z.string(),
  z.unknown(),
) as z.ZodType<JsonSchemaRecord, JsonSchemaRecord>;
