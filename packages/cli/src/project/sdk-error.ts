import { OsvaApiError, OsvaTransportError } from "@osva-ai/sdk";

import { redactSecrets } from "../doctor/redact.js";

export function mapProjectSdkError(input: {
  readonly error: unknown;
  readonly json: boolean;
}): { ok: false; exitCode: number; stdout?: string; message?: string } | null {
  if (input.error instanceof OsvaApiError) {
    if (input.json) {
      return {
        ok: false,
        exitCode: 1,
        stdout: `${JSON.stringify(
          {
            error: {
              kind: "api",
              status: input.error.status,
              body: input.error.body,
              requestId: input.error.requestId,
            },
          },
          null,
          2,
        )}\n`,
      };
    }
    const requestSuffix =
      input.error.requestId === undefined
        ? ""
        : ` (requestId: ${input.error.requestId})`;
    return {
      ok: false,
      exitCode: 1,
      message: redactSecrets(`${input.error.message}${requestSuffix}`),
    };
  }

  if (input.error instanceof OsvaTransportError) {
    if (input.json) {
      return {
        ok: false,
        exitCode: 1,
        stdout: `${JSON.stringify(
          {
            error: {
              kind: "transport",
              message: redactSecrets(input.error.message),
            },
          },
          null,
          2,
        )}\n`,
      };
    }
    return {
      ok: false,
      exitCode: 1,
      message: redactSecrets(input.error.message),
    };
  }

  return null;
}
