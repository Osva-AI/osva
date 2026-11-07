import { AUTHORIZATION_ACTIONS } from "@osva-ai/contracts";

import {
  controlPlaneWorkspaceId,
  requireControlPlaneAuthorization,
  type ControlPlaneScope,
} from "../control-plane.js";
import { CONTROL_PLANE_RESOURCE_KINDS } from "../control-plane-resource-kinds.js";
import { BuilderPublicationNotFoundError } from "../errors.js";
import type { BuilderPublicationRepository } from "../ports/builder-publication-repository.js";

import type {
  BuilderPublicationId,
  BuilderPublicationReceiptV1,
} from "./builder-publication-types.js";

const WORKFLOW_RESOURCE = { kind: CONTROL_PLANE_RESOURCE_KINDS.workflow };

export class GetBuilderPublicationReceipt {
  constructor(private readonly publications: BuilderPublicationRepository) {}

  async execute(
    scope: ControlPlaneScope,
    publicationId: BuilderPublicationId,
  ): Promise<BuilderPublicationReceiptV1> {
    requireControlPlaneAuthorization(
      scope,
      AUTHORIZATION_ACTIONS.READ,
      WORKFLOW_RESOURCE,
    );

    const workspaceId = controlPlaneWorkspaceId(scope);
    const stored = await this.publications.findByWorkspaceAndPublicationId(
      workspaceId,
      publicationId,
    );
    if (stored === null) {
      throw new BuilderPublicationNotFoundError(publicationId);
    }

    return stored.receipt;
  }
}
