import type { AuthenticateApiKey } from "@osva/domain";
import { emitSecurityEvent, SECURITY_EVENT_NAMES } from "@osva/observability";

import type { WebSecurityServices } from "./http-security.js";
import { resolveRequestId } from "./security-request-context.js";

export function createWebSecurityServices(
  authenticateApiKey: AuthenticateApiKey,
): WebSecurityServices {
  return {
    authenticateBearerToken: async (token) => {
      const result = await authenticateApiKey.executeDetailed(token);
      if (result.outcome === "authenticated") {
        return result.principal;
      }

      emitSecurityEvent({
        event: SECURITY_EVENT_NAMES.AUTH_AUTHENTICATION_FAILED,
        requestId: resolveRequestId(),
        outcome: "DENIED",
        reasonCode: result.reason,
      });
      return null;
    },
  };
}
