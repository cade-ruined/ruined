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
  signOffText?: string;
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
  typography?: "ruined";
  signOff?: ResendEmailSignOff | null;
};
export type ResendEmailBanner = { url: string; alt: string; linkUrl?: string };
export type ResendEmailSignOff = { text: string };
/** Server-generated artwork; dimensions are the intended display size. */
export type ResendEmailSignOffImage = { url: string; width: number; height: number };
export type RenderedResendEmail = {
  html: string;
  text: string;
  subject: string;
  from: string;
  replyTo: string[];
};
