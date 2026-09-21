import type { ServerResponse } from "node:http";

import type { PublicApiErrorCode } from "@osva/contracts";
import { OSVA_REQUEST_ID_HEADER } from "@osva/contracts";

import { sendJson } from "./json.js";

export function sendV1Error(
  response: ServerResponse,
  statusCode: number,
  code: PublicApiErrorCode,
  requestId: string,
): void {
  sendJson(
    response,
    statusCode,
    {
      status: "error",
      code,
      requestId,
    },
    {
      [OSVA_REQUEST_ID_HEADER]: requestId,
    },
  );
}
