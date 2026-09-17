import type {
  ConnectorAuthConfig,
  ConnectorId,
  ConnectorKind,
  ConnectorTransport,
  ConnectorTransportConfig,
  ConnectorVersionId,
} from "@osva/contracts";
import {
  isConnectorKind,
  isConnectorTransport,
  isStdioTransportConfig,
  isStreamableHttpTransportConfig,
} from "@osva/contracts";

import { DomainInvariantError } from "./errors.js";
import {
  copyInstant,
  deepFreeze,
  requirePositiveInteger,
} from "./internals.js";

export interface ConnectorVersionProps {
  readonly id: ConnectorVersionId;
  readonly connectorId: ConnectorId;
  readonly version: number;
  readonly kind: ConnectorKind;
  readonly transport: ConnectorTransport;
  readonly transportConfig: ConnectorTransportConfig;
  readonly auth?: ConnectorAuthConfig;
  readonly createdAt: Date;
}

export class ConnectorVersion {
  readonly id: ConnectorVersionId;
  readonly connectorId: ConnectorId;
  readonly version: number;
  readonly kind: ConnectorKind;
  readonly transport: ConnectorTransport;
  readonly transportConfig: ConnectorTransportConfig;
  readonly auth: ConnectorAuthConfig | undefined;
  readonly createdAt: Date;

  private constructor(props: ConnectorVersionProps) {
    this.id = props.id;
    this.connectorId = props.connectorId;
    this.version = props.version;
    this.kind = props.kind;
    this.transport = props.transport;
    this.transportConfig = props.transportConfig;
    this.auth = props.auth;
    this.createdAt = props.createdAt;
  }

  static create(props: ConnectorVersionProps): ConnectorVersion {
    if (!props.id) {
      throw new DomainInvariantError("ConnectorVersion.id is required.");
    }

    if (!props.connectorId) {
      throw new DomainInvariantError(
        "ConnectorVersion.connectorId is required.",
      );
    }

    if (!isConnectorKind(props.kind)) {
      throw new DomainInvariantError(
        "ConnectorVersion.kind must be a supported connector kind.",
      );
    }

    if (!isConnectorTransport(props.transport)) {
      throw new DomainInvariantError(
        "ConnectorVersion.transport must be a supported connector transport.",
      );
    }

    validateTransportConfig(props.transport, props.transportConfig);

    return Object.freeze(
      new ConnectorVersion({
        id: props.id,
        connectorId: props.connectorId,
        version: requirePositiveInteger(
          props.version,
          "ConnectorVersion.version",
        ),
        kind: props.kind,
        transport: props.transport,
        transportConfig: deepFreeze(props.transportConfig),
        auth: props.auth === undefined ? undefined : deepFreeze(props.auth),
        createdAt: copyInstant(props.createdAt),
      }),
    );
  }
}

function validateTransportConfig(
  transport: ConnectorTransport,
  config: ConnectorTransportConfig,
): void {
  if (transport === "STREAMABLE_HTTP") {
    if (!isStreamableHttpTransportConfig(config)) {
      throw new DomainInvariantError(
        "ConnectorVersion.transportConfig must match STREAMABLE_HTTP transport.",
      );
    }
    return;
  }

  if (!isStdioTransportConfig(config)) {
    throw new DomainInvariantError(
      "ConnectorVersion.transportConfig must match STDIO transport.",
    );
  }
}
