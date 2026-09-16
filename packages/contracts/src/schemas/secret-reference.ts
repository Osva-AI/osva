import { z } from "zod";

export const SECRET_REFERENCE_KEY_MAX_LENGTH = 128;

export const secretReferenceSchema = z.strictObject({
  key: z.string().min(1).max(SECRET_REFERENCE_KEY_MAX_LENGTH),
});
