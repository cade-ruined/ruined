export type AdminEmailPurpose = "marketing" | "service";
export type AdminEmailAudience = "individual" | "updates" | "members";
export type AdminEmailContent = {
  subject: string;
  preheader: string;
  body: string;
  purpose: AdminEmailPurpose;
  audience: AdminEmailAudience;
  recipients: string[];
};
export const ADMIN_EMAIL_MAX_RECIPIENTS = 250;
export const ADMIN_EMAIL_DELIVERY_STATUSES = ["pending", "sending", "sent", "failed", "skipped", "manual_review"] as const;
export type AdminEmailDeliveryStatus = (typeof ADMIN_EMAIL_DELIVERY_STATUSES)[number];
export type AdminEmailDraft = AdminEmailContent & {
  id: string;
  version: number;
  status: "draft" | "queued";
  createdAt: string;
  updatedAt: string;
  queuedAt: string | null;
  recipientCount: number;
  deliveryCounts: Record<AdminEmailDeliveryStatus, number>;
};
export type AdminEmailPreview = {
  draftId: string;
  version: number;
  recipientHash: string;
  recipientCount: number;
  recipients: Array<{ email: string; name: string }>;
  excludedCount: number;
};
export class AdminEmailError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AdminEmailError";
  }
}
export function isAdminEmailAddress(value: string): boolean {
  return value.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);
}
export function normalizeAdminEmailContent(input: AdminEmailContent): AdminEmailContent {
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const preheader = typeof input.preheader === "string" ? input.preheader.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim().replace(/\r\n?/g, "\n") : "";
  if (!subject || subject.length > 200 || /[\r\n\x00]/.test(subject)) throw new AdminEmailError(400, "Add a subject of 200 characters or fewer.");
  if (preheader.length > 200 || /[\r\n\x00]/.test(preheader)) throw new AdminEmailError(400, "Preview text must be 200 characters or fewer.");
  if (!body || body.length > 12_000 || body.includes("\0")) throw new AdminEmailError(400, "Add an email body of 12,000 characters or fewer.");
  if (!["marketing", "service"].includes(input.purpose) || !["individual", "updates", "members"].includes(input.audience)) throw new AdminEmailError(400, "Choose an email purpose and audience.");
  if (input.audience === "updates" && input.purpose !== "marketing") throw new AdminEmailError(400, "General updates require marketing consent.");
  if (!Array.isArray(input.recipients) || input.recipients.some(email => typeof email !== "string")) throw new AdminEmailError(400, "Recipients must be email addresses.");
  const recipients = input.audience === "individual" ? [...new Set(input.recipients.map(email => email.trim().toLowerCase()))].sort() : [];
  if (recipients.some(email => !isAdminEmailAddress(email)) || recipients.length > ADMIN_EMAIL_MAX_RECIPIENTS) throw new AdminEmailError(400, `Add up to ${ADMIN_EMAIL_MAX_RECIPIENTS} valid email addresses.`);
  if (input.audience === "individual" && !recipients.length) throw new AdminEmailError(400, "Add at least one recipient.");
  return { subject, preheader, body, purpose: input.purpose, audience: input.audience, recipients };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
/** Authored text is always escaped; neither the administrator nor the model supplies HTML. */
export function renderAdminEmail(content: Pick<AdminEmailContent, "subject" | "preheader" | "body">, unsubscribeUrl?: string, postalAddress?: string) {
  const footer = unsubscribeUrl ? `\n\nThe Ruined Project\n${postalAddress ?? ""}\nUnsubscribe from Ruined updates: ${unsubscribeUrl}` : "";
  const paragraphs = content.body.split(/\n{2,}/).map(value => `<p style="margin:0 0 22px">${escapeHtml(value).replaceAll("\n", "<br>")}</p>`).join("");
  return {
    subject: content.subject,
    text: `${content.body}${footer}`,
    html: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.subject)}</title></head><body style="margin:0;background:#f5f3ee;color:#171714"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(content.preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:40px 24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:auto"><tr><td style="padding-bottom:32px;font:20px Arial,sans-serif">Ruined</td></tr><tr><td style="font:16px/1.7 Arial,sans-serif">${paragraphs}</td></tr><tr><td style="border-top:1px solid #d7d4ca;padding-top:24px;font:12px/1.6 Arial,sans-serif;color:#6a685f">The Ruined Project${unsubscribeUrl ? `<br>${escapeHtml(postalAddress ?? "").replaceAll("\n", "<br>")}<br><a href="${escapeHtml(unsubscribeUrl)}" style="color:inherit">Unsubscribe from Ruined updates</a>` : ""}</td></tr></table></td></tr></table></body></html>`,
  };
}
