import { z } from "zod";

import {
  INTERNAL_TOOL_IMPLEMENTATIONS,
  TOOL_BINDING_NAME_PATTERN,
  TOOL_TYPES,
} from "../tool-gateway.js";

export const toolBindingNameSchema = z
  .string()
  .regex(TOOL_BINDING_NAME_PATTERN, {
    message:
      "tool binding names must start with a letter and use only letters, digits, '_' or '-'.",
  });

export const toolTypeSchema = z.enum(TOOL_TYPES);

export const internalToolImplementationIdSchema = z.enum(
  INTERNAL_TOOL_IMPLEMENTATIONS,
);
