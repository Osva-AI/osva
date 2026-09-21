import { PUBLIC_API_ERROR_CODES } from "@osva/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { sendHttpError } from "../src/http-errors.js";
import { InvalidJsonBodyError, RequestBodyTooLargeError } from "../src/json.js";
import {
  AuthenticationRequiredError,
  PermissionDeniedError,
  WorkspaceNotFoundError,
  StdioConnectorsDisabledError,
} from "@osva/domain";

function mockResponse() {
  const headers: Record<string, string> = {};
  let statusCode = 0;
  let body = "";
  return {
    response: {
      writeHead(code: number, hdrs?: Record<string, string>) {
        statusCode = code;
        Object.assign(headers, hdrs ?? {});
      },
      end(payload?: string) {
        body = payload ?? "";
      },
    },
    get result() {
      return {
        statusCode,
        headers,
        body: body.length === 0 ? undefined : JSON.parse(body),
      };
    },
  };
}

describe("stable v1 error envelope", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps authentication, authorization, not-found, invalid JSON, and payload limits", () => {
    const cases: Array<{ error: unknown; status: number; code?: string }> = [
      {
        error: new AuthenticationRequiredError(),
        status: 401,
        code: PUBLIC_API_ERROR_CODES.AUTHENTICATION_REQUIRED,
      },
      {
        error: new PermissionDeniedError(),
        status: 403,
        code: PUBLIC_API_ERROR_CODES.PERMISSION_DENIED,
      },
      {
        error: new WorkspaceNotFoundError("ws-1" as never),
        status: 404,
        code: PUBLIC_API_ERROR_CODES.RESOURCE_NOT_FOUND,
      },
      {
        error: new InvalidJsonBodyError(),
        status: 400,
      },
      {
        error: new RequestBodyTooLargeError(),
        status: 413,
        code: PUBLIC_API_ERROR_CODES.REQUEST_TOO_LARGE,
      },
      {
        error: new StdioConnectorsDisabledError(),
        status: 403,
        code: PUBLIC_API_ERROR_CODES.PERMISSION_DENIED,
      },
    ];

    for (const testCase of cases) {
      const mock = mockResponse();
      sendHttpError(mock.response as never, testCase.error);
      expect(mock.result.statusCode).toBe(testCase.status);
      if (testCase.code !== undefined) {
        expect(mock.result.body).toMatchObject({
          status: "error",
          code: testCase.code,
          requestId: expect.any(String),
        });
      }
    }
  });
});
