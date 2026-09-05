export type ArtifactAwardRequestIdentity = {
  acquisitionType: string;
  memberId: string;
  reason: string;
  templateVersionId: string;
};

export type ArtifactTemplateAwardability = {
  bindingVerified: boolean;
  livemode: boolean | null;
  status: string;
  versionId: string | null;
  versionStatus: string | null;
};

const SHIPMENT_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  exception: new Set(["in_transit", "delivered", "returned", "cancelled"]),
  in_transit: new Set(["delivered", "exception", "returned"]),
  label_created: new Set(["in_transit", "delivered", "exception", "cancelled"]),
};

export function canTransitionArtifactShipment(previousStatus: string, nextStatus: string): boolean {
  return previousStatus === nextStatus || Boolean(SHIPMENT_TRANSITIONS[previousStatus]?.has(nextStatus));
}

export function isLiveAwardableArtifactTemplate(template: ArtifactTemplateAwardability): boolean {
  return template.status === "active"
    && template.versionId !== null
    && template.versionStatus === "published"
    && template.livemode === true
    && template.bindingVerified;
}

export function matchesArtifactAwardRequest(
  existing: ArtifactAwardRequestIdentity,
  requested: ArtifactAwardRequestIdentity,
): boolean {
  return existing.memberId === requested.memberId
    && existing.templateVersionId === requested.templateVersionId
    && existing.acquisitionType === requested.acquisitionType
    && existing.reason === requested.reason;
}
