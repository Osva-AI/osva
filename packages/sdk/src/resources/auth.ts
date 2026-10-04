import { z } from "zod";

import type { OsvaHttpClient } from "../http-client.js";

export const authContextResourceSchema = z.strictObject({
  subjectId: z.string().min(1),
  workspaceId: z.string().min(1),
  role: z.string().min(1),
});

export type AuthContextResource = z.infer<typeof authContextResourceSchema>;

export class AuthResource {
  constructor(private readonly client: OsvaHttpClient) {}

  getContext(): Promise<AuthContextResource> {
    return this.client.request({
      method: "GET",
      path: "/v1/auth/context",
    });
  }
}
