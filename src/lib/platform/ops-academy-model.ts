export type OpsAcademyStatus = "draft" | "published" | "retired" | "unpublished";

export type OpsAcademyAudienceKind = "all_members" | "block" | "circle";

export type OpsAcademyAudience = {
  id: string | null;
  kind: OpsAcademyAudienceKind;
  label: string;
};

export type OpsAcademyCollection = {
  collectionId: string;
  name: string;
  position: number;
  publishedAt: string | null;
  resourceCount: number;
  revision: number;
  slug: string;
  status: OpsAcademyStatus;
  summary: string | null;
};

export type OpsAcademyResourceSummary = {
  audiences: OpsAcademyAudience[];
  collectionId: string | null;
  collectionName: string | null;
  contentType: string;
  currentVersion: number | null;
  hasUnpublishedChanges: boolean;
  latestVersion: number;
  position: number;
  publishedAt: string | null;
  resourceId: string;
  revision: number;
  slug: string;
  status: OpsAcademyStatus;
  summary: string | null;
  thumbnailUrl: string | null;
  title: string;
};

export type OpsAcademySnapshot = {
  canManage: boolean;
  collections: OpsAcademyCollection[];
  counts: Record<OpsAcademyStatus, number>;
  resources: OpsAcademyResourceSummary[];
};

export type OpsAcademyResourceDraft = OpsAcademyResourceSummary & {
  bodyText: string | null;
  captionsUrl: string | null;
  durationLabel: string | null;
  externalUrl: string | null;
  featured: boolean;
  presenter: string | null;
  videoUrl: string | null;
};

export type OpsAcademyReferenceOptions = {
  blocks: Array<{ id: string; label: string }>;
  circles: Array<{ id: string; label: string }>;
  collections: Array<{ id: string; label: string; status: OpsAcademyStatus }>;
};

export type OpsAcademyEditorData = {
  canManage: boolean;
  options: OpsAcademyReferenceOptions;
  resource: OpsAcademyResourceDraft;
};
