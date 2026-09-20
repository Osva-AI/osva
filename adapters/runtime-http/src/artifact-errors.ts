import { ARTIFACT_ERROR_CODES } from "@osva/contracts";
import {
  ArtifactBlobUnavailableError,
  ArtifactDigestMismatchError,
  ArtifactIdempotencyConflictError,
  ArtifactNotFoundError,
  ArtifactPayloadTooLargeError,
  ArtifactWorkspaceMismatchError,
} from "@osva/domain";

export function mapArtifactDomainError(
  error: unknown,
  fallbackCode: string = ARTIFACT_ERROR_CODES.ARTIFACT_UNAVAILABLE,
  fallbackMessage: string = "Artifact capability failed.",
): { readonly code: string; readonly message: string } {
  if (error instanceof ArtifactNotFoundError) {
    return {
      code: ARTIFACT_ERROR_CODES.ARTIFACT_NOT_FOUND,
      message: error.message,
    };
  }

  if (error instanceof ArtifactWorkspaceMismatchError) {
    return {
      code: ARTIFACT_ERROR_CODES.ARTIFACT_WORKSPACE_MISMATCH,
      message: error.message,
    };
  }

  if (error instanceof ArtifactIdempotencyConflictError) {
    return {
      code: ARTIFACT_ERROR_CODES.ARTIFACT_IDEMPOTENCY_CONFLICT,
      message: error.message,
    };
  }

  if (error instanceof ArtifactPayloadTooLargeError) {
    return {
      code: ARTIFACT_ERROR_CODES.ARTIFACT_PAYLOAD_TOO_LARGE,
      message: error.message,
    };
  }

  if (error instanceof ArtifactDigestMismatchError) {
    return {
      code: ARTIFACT_ERROR_CODES.ARTIFACT_DIGEST_MISMATCH,
      message: error.message,
    };
  }

  if (error instanceof ArtifactBlobUnavailableError) {
    return {
      code: ARTIFACT_ERROR_CODES.ARTIFACT_UNAVAILABLE,
      message: error.message,
    };
  }

  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
  ) {
    const message = error instanceof Error ? error.message : fallbackMessage;
    return { code: error.code, message };
  }

  return { code: fallbackCode, message: fallbackMessage };
}
