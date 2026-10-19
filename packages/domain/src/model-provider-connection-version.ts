import type {
  ModelProviderConnectionEndpoint,
  ModelProviderConnectionId,
  ModelProviderConnectionVersionId,
  SecretReference,
} from "@osva-ai/contracts";
import { isAllowedRemoteRuntimeEndpoint } from "@osva-ai/contracts";

import { DomainInvariantError } from "./errors.js";
import {
  copyInstant,
  deepFreeze,
  requireNonEmptyString,
  requirePositiveInteger,
} from "./internals.js";

export interface ModelProviderConnectionVersionProps {
  readonly id: ModelProviderConnectionVersionId;
  readonly connectionId: ModelProviderConnectionId;
  readonly version: number;
  readonly endpoint?: ModelProviderConnectionEndpoint;
  readonly credentialRef?: SecretReference;
  readonly createdAt: Date;
}

export class ModelProviderConnectionVersion {
  readonly id: ModelProviderConnectionVersionId;
  readonly connectionId: ModelProviderConnectionId;
  readonly version: number;
  readonly endpoint: ModelProviderConnectionEndpoint | undefined;
  readonly credentialRef: SecretReference | undefined;
  readonly createdAt: Date;

  private constructor(props: ModelProviderConnectionVersionProps) {
    this.id = props.id;
    this.connectionId = props.connectionId;
    this.version = props.version;
    this.endpoint = props.endpoint;
    this.credentialRef = props.credentialRef;
    this.createdAt = props.createdAt;
  }

  static create(
    props: ModelProviderConnectionVersionProps,
  ): ModelProviderConnectionVersion {
    if (!props.id) {
      throw new DomainInvariantError(
        "ModelProviderConnectionVersion.id is required.",
      );
    }

    if (!props.connectionId) {
      throw new DomainInvariantError(
        "ModelProviderConnectionVersion.connectionId is required.",
      );
    }

    const endpoint =
      props.endpoint === undefined
        ? undefined
        : validateEndpoint(props.endpoint);
    const credentialRef =
      props.credentialRef === undefined
        ? undefined
        : validateCredentialRef(props.credentialRef);

    return Object.freeze(
      new ModelProviderConnectionVersion({
        id: props.id,
        connectionId: props.connectionId,
        version: requirePositiveInteger(
          props.version,
          "ModelProviderConnectionVersion.version",
        ),
        endpoint,
        credentialRef,
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }
}

function validateEndpoint(
  endpoint: ModelProviderConnectionEndpoint,
): ModelProviderConnectionEndpoint {
  const baseUrl = requireNonEmptyString(
    endpoint.baseUrl,
    "ModelProviderConnectionVersion.endpoint.baseUrl",
  );
  if (!isAllowedRemoteRuntimeEndpoint(baseUrl)) {
    throw new DomainInvariantError(
      "ModelProviderConnectionVersion.endpoint.baseUrl must be a valid http(s) URL without embedded credentials.",
    );
  }

  return deepFreeze({
    baseUrl,
    ...(endpoint.allowPrivateNetworks === undefined
      ? {}
      : { allowPrivateNetworks: endpoint.allowPrivateNetworks }),
  });
}

function validateCredentialRef(reference: SecretReference): SecretReference {
  return deepFreeze({
    key: requireNonEmptyString(reference.key, "SecretReference.key"),
  });
}
