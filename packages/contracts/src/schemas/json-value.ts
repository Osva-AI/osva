import { z } from "zod";

import { isCanonicalJsonValue, type JsonValue } from "../json-value.js";

export const jsonValueSchema = z.custom<JsonValue>(
  (value) => isCanonicalJsonValue(value),
  { message: "value must be JSON-compatible" },
);
