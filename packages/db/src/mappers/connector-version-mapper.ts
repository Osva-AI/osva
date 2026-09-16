import type {
  ConnectorId,
  ConnectorKind,
  ConnectorTransport,
  ConnectorVersionId,
} from "@osva/contracts";
import { ConnectorVersion } from "@osva/domain";

import type { connectorVersions } from "../schema/connector-versions.js";
import { toDomainDate } from "./timestamps.js";

type ConnectorVersionRow = typeof connectorVersions.$inferSelect;

export function connectorVersionToRow(version: ConnectorVersion) {
  return {
    id: version.id,
    connectorId: version.connectorId,
    version: version.version,
    kind: version.kind,
    transport: version.transport,
    transportConfig: version.transportConfig,
    auth: version.auth ?? null,
    createdAt: version.createdAt,
  };
}

export function connectorVersionFromRow(
  row: ConnectorVersionRow,
): ConnectorVersion {
  return ConnectorVersion.create({
    id: row.id as ConnectorVersionId,
    connectorId: row.connectorId as ConnectorId,
    version: row.version,
    kind: row.kind as ConnectorKind,
    transport: row.transport as ConnectorTransport,
    transportConfig: row.transportConfig,
    auth: row.auth ?? undefined,
    createdAt: toDomainDate(row.createdAt),
  });
}

export function isSameConnectorVersion(
  left: ConnectorVersion,
  right: ConnectorVersion,
): boolean {
  return (
    left.id === right.id &&
    left.connectorId === right.connectorId &&
    left.version === right.version &&
    left.kind === right.kind &&
    left.transport === right.transport &&
    JSON.stringify(left.transportConfig) ===
      JSON.stringify(right.transportConfig) &&
    JSON.stringify(left.auth) === JSON.stringify(right.auth) &&
    left.createdAt.getTime() === right.createdAt.getTime()
  );
}
