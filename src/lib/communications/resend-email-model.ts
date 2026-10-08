export type ResendEmailTemplateSummary = {
  id: string;
  name: string;
  status: "draft" | "published";
  version?: string;
  hasUnpublishedVersions?: boolean;
};
export type ResendEmailTemplateVariable = {
  key: string;
  type: "string" | "number";
  fallbackValue: string | number | null;
};
export type ResendEmailTemplateField = { key: string; label: string; value: string };
export type ResendEmailTemplate = ResendEmailTemplateSummary & {
  version: string;
  hasUnpublishedVersions: boolean;
  campaignOnly?: boolean;
  html: string;
  text: string | null;
  subject: string;
  from: string;
  replyTo: string[];
  variables: ResendEmailTemplateVariable[];
  fields: ResendEmailTemplateField[];
};
export type ResendEmailEdits = {
  subject: string;
  values: Record<string, string>;
  copy: Record<string, string>;
  banner?: ResendEmailBanner | null;
};
export type ResendEmailBanner = { url: string; alt: string; linkUrl?: string };
export type RenderedResendEmail = {
  html: string;
  text: string;
  subject: string;
  from: string;
  replyTo: string[];
};
