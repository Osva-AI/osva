import {
  classifyProviderDestination,
  isForbiddenFakeOrigin,
} from "./provider-routing.mjs";

/**
 * @typedef {Object} ProviderProvenanceEvidence
 * @property {boolean} liveModeRequested
 * @property {boolean} liveModeAuthorized
 * @property {number} actualProviderCallsObserved
 * @property {boolean} providerIdentityVerified
 * @property {string} [providerCategory]
 * @property {string} [modelIdentifier]
 * @property {string} [connectionVersionId]
 * @property {string} [verifiedDestinationCategory]
 * @property {boolean} [adapterInvocationSucceeded]
 * @property {string} [completionStatus]
 * @property {string} [sanitizedProviderRequestId]
 * @property {string} [verificationCode]
 */

export function createEmptyProvenance() {
  return /** @type {ProviderProvenanceEvidence} */ ({
    liveModeRequested: false,
    liveModeAuthorized: false,
    actualProviderCallsObserved: 0,
    providerIdentityVerified: false,
  });
}

/**
 * @param {ProviderProvenanceEvidence} state
 * @param {{
 *   requested: boolean,
 *   authorized: boolean,
 *   provider: string,
 *   modelId: string,
 *   connectionVersionId?: string,
 *   endpointBaseUrl?: string,
 *   forbiddenOrigins?: string[],
 *   invocationSucceeded?: boolean,
 *   providerRequestId?: string,
 * }} event
 */
export function recordProviderInvocation(state, event) {
  state.liveModeRequested = event.requested;
  state.liveModeAuthorized = event.authorized;
  state.providerCategory = event.provider.toUpperCase();
  state.modelIdentifier = event.modelId;
  if (event.connectionVersionId !== undefined) {
    state.connectionVersionId = event.connectionVersionId;
  }

  if (
    event.endpointBaseUrl !== undefined &&
    isForbiddenFakeOrigin(event.endpointBaseUrl, event.forbiddenOrigins ?? [])
  ) {
    state.verificationCode = "FAKE_PROVIDER_FALLBACK";
    state.providerIdentityVerified = false;
    return state;
  }

  const dest = classifyProviderDestination(event.endpointBaseUrl);
  state.verifiedDestinationCategory = dest;
  if (dest === "PRIVATE_OR_LOOPBACK") {
    state.verificationCode = "UNVERIFIED_PROVIDER";
    state.providerIdentityVerified = false;
    return state;
  }

  if (event.invocationSucceeded === true) {
    state.actualProviderCallsObserved += 1;
    state.adapterInvocationSucceeded = true;
    state.completionStatus = "SUCCEEDED";
    state.providerIdentityVerified = dest === "OFFICIAL" || dest === "MISSING";
    if (event.providerRequestId !== undefined) {
      state.sanitizedProviderRequestId = sanitizeRequestId(
        event.providerRequestId,
      );
    }
  } else if (event.invocationSucceeded === false) {
    state.adapterInvocationSucceeded = false;
    state.completionStatus = "FAILED";
    state.providerIdentityVerified = false;
    state.verificationCode = "ADAPTER_INVOCATION_FAILED";
  }

  return state;
}

/**
 * @param {ProviderProvenanceEvidence} state
 */
export function deriveLiveProviderCallsFlag(state) {
  return (
    state.providerIdentityVerified === true &&
    state.actualProviderCallsObserved > 0
  );
}

/**
 * @param {string} id
 */
function sanitizeRequestId(id) {
  const trimmed = id.trim();
  if (trimmed.length <= 8) {
    return "[REDACTED]";
  }
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}
