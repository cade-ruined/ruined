import "server-only";

import { createHash } from "node:crypto";
import type { GetBroadcastResponseSuccess, ListEmail, Topic } from "resend";
import { getApplicationDatabase } from "@/lib/database/server";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { AdminEmailError, isAdminEmailAddress } from "./admin-email-model";
import { assertAdminEmailAccess, requireAdminEmailActor } from "./admin-email-repository";
import { prepareAdminEmailSignOff } from "./admin-email-sign-off";
import { normalizeResendEmailSignOff, normalizeResendTemplate, renderResendEmailTemplate } from "./resend-email-templates";
import type { ResendEmailEdits } from "./resend-email-model";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function id(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new AdminEmailError(400, "Choose a valid Resend record.");
  return value;
}
function record(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function line(value: unknown, fallback = "") {
  const text = typeof value === "string" ? value.trim() : fallback;
  if (!text || text.length > 200 || /[\r\n\0]/.test(text)) throw new AdminEmailError(400, "Add a subject or campaign name of 200 characters or fewer.");
  return text;
}
export function getResendEmailConfiguration() {
  const connected = Boolean(process.env.RESEND_API_KEY?.trim());
  const enabled = process.env.ADMIN_EMAIL_SENDING_ENABLED === "true" && getPlatformConfiguration().mode === "connected";
  return { connected, sendingReady: connected && enabled,
    issues: [...(!connected ? ["Connect Resend to load your templates and audiences."] : []),
      ...(!enabled ? ["Sending is disabled until email setup is complete."] : [])] };
}
// Share pacing across requests in this process. Provider rate limiting remains authoritative across instances.
let nextRequest = 0;
async function provider<T>(path: string, method = "GET", body?: unknown, idempotencyKey?: string): Promise<T> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new AdminEmailError(503, "Resend is not connected yet.");
  const wait = Math.max(0, nextRequest - Date.now());
  nextRequest = Date.now() + wait + 150;
  if (wait) await new Promise(resolve => setTimeout(resolve, wait));
  let response: Response;
  try {
    response = await fetch(`https://api.resend.com${path}`, { method, cache: "no-store", signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch { throw new AdminEmailError(503, "Resend did not return a result. Check the sending history before trying again."); }
  if (!response.ok) {
    if (response.status === 404) throw new AdminEmailError(404, "This record was not found in Resend. Refresh the workspace.");
    if (response.status === 429) throw new AdminEmailError(503, "Resend is busy. Wait a moment and try again.");
    if ([400, 422].includes(response.status)) throw new AdminEmailError(422, "Resend could not accept this email. Check the template, sender and audience in Resend. Dashboard-created campaigns may need to be sent there.");
    throw new AdminEmailError(503, "Resend is unavailable or this API key does not have access. Check the connection in Resend.");
  }
  return response.json() as Promise<T>;
}
type Page<T> = { data: T[]; has_more: boolean };
async function all<T extends { id: string }>(path: string, limit = 1000): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let after = "";
  do {
    const page = await provider<Page<T>>(`${path}${path.includes("?") ? "&" : "?"}limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`);
    if (!Array.isArray(page.data) || typeof page.has_more !== "boolean") throw new AdminEmailError(502, "Resend returned an incomplete list. Refresh before continuing.");
    for (const item of page.data) {
      if (!item.id || seen.has(item.id)) throw new AdminEmailError(502, "Resend's list changed while loading. Refresh before continuing.");
      seen.add(item.id); items.push(item);
    }
    if (items.length > limit) throw new AdminEmailError(400, `This selection exceeds the ${limit}-record review limit. Use a smaller audience in Resend.`);
    if (!page.has_more) return items;
    after = page.data.at(-1)?.id ?? "";
    if (!after || items.length >= limit) throw new AdminEmailError(400, `This selection exceeds the ${limit}-record review limit. Use a smaller audience in Resend.`);
  } while (after);
  throw new AdminEmailError(502, "Resend returned an incomplete list.");
}
const broadcastSummary = (item: Partial<GetBroadcastResponseSuccess>) => ({ id: item.id!, name: item.name ?? "Untitled campaign", subject: item.subject ?? "", status: item.status!, createdAt: item.created_at! });
const emailSummary = (item: ListEmail) => ({ id: item.id, subject: item.subject, to: item.to, lastEvent: item.last_event, createdAt: item.created_at });
export async function getResendEmailHistory(actor: string, collection: string, cursor?: string) {
  await assertAdminEmailAccess(actor);
  if (!["broadcasts", "emails"].includes(collection)) throw new AdminEmailError(400, "Choose a history list.");
  if (cursor) id(cursor);
  const page = await provider<Page<ListEmail & GetBroadcastResponseSuccess>>(`/${collection}?limit=50${cursor ? `&after=${cursor}` : ""}`);
  return { items: page.data.map(item => collection === "broadcasts" ? broadcastSummary(item) : emailSummary(item)), nextCursor: page.has_more ? page.data.at(-1)?.id ?? null : null };
}
export async function getResendEmailOverview(actor: string) {
  await assertAdminEmailAccess(actor);
  const configuration = getResendEmailConfiguration();
  if (!configuration.connected) return { templates: [], segments: [], topics: [], broadcasts: [], emails: [], configuration, cursors: { broadcasts: null, emails: null } };
  const templates = await all<{ id: string; name: string; status: string; updated_at: string }>("/templates");
  const segments = await all<{ id: string; name: string }>("/segments");
  const topics = await provider<{ data: Topic[] }>("/topics");
  const broadcasts = await getResendEmailHistory(actor, "broadcasts");
  const emails = await getResendEmailHistory(actor, "emails");
  return { templates: templates.map(item => ({ id: item.id, name: item.name, status: item.status, updatedAt: item.updated_at })),
    segments, topics: topics.data.map(item => ({ id: item.id, name: item.name, defaultSubscription: item.default_subscription })),
    broadcasts: broadcasts.items, emails: emails.items, configuration, cursors: { broadcasts: broadcasts.nextCursor, emails: emails.nextCursor } };
}
/** Local design preview only: no contacts, history, credentials or mutation routes are exposed. */
export async function getResendEmailPreviewCatalog() {
  if (process.env.NODE_ENV === "production" || getPlatformConfiguration().mode !== "preview" || !process.env.RESEND_API_KEY?.trim()) return null;
  const listed = await all<{ id: string }>("/templates", 100);
  const templates = [];
  for (const item of listed) templates.push(normalizeResendTemplate(await provider(`/templates/${id(item.id)}`)));
  const segments = await all<{ id: string; name: string }>("/segments");
  const topics = await provider<{ data: Topic[] }>("/topics");
  return { templates, segments, topics: topics.data.map(item => ({ id: item.id, name: item.name, defaultSubscription: item.default_subscription })) };
}
export async function getResendEmailTemplate(actor: string, templateId: unknown) {
  await assertAdminEmailAccess(actor);
  return normalizeResendTemplate(await provider(`/templates/${id(templateId)}`));
}
export async function getResendEmailBroadcast(actor: string, broadcastId: unknown) {
  await assertAdminEmailAccess(actor);
  const item = await provider<GetBroadcastResponseSuccess>(`/broadcasts/${id(broadcastId)}`);
  return { id: item.id, name: item.name, subject: item.subject ?? "", status: item.status, html: item.html ?? "", from: item.from ?? "",
    segmentId: item.segment_id ?? item.audience_id, topicId: item.topic_id, previewText: item.preview_text ?? "" };
}
export async function prepareResendEmail(actor: string, input: Record<string, unknown>, options: { persistSignOff?: boolean } = {}) {
  const template = await getResendEmailTemplate(actor, input.templateId);
  if (input.templateVersion !== template.version) throw new AdminEmailError(409, "This template changed in Resend. Reload it and review your copy again.");
  if (!["individual", "campaign"].includes(String(input.mode))) throw new AdminEmailError(400, "Choose individual email or campaign.");
  if (!record(input.edits)) throw new AdminEmailError(400, "Template edits are required.");
  const edits = input.edits as unknown as ResendEmailEdits;
  const signOff = normalizeResendEmailSignOff(edits.signOff);
  const campaign = input.mode === "campaign";
  // Validate all editable content before generating or retaining any artwork.
  // Client-supplied assets never become trusted renderer options.
  const validated = renderResendEmailTemplate(template, signOff ? { ...edits, signOff: null } : edits, { campaign });
  const from = validated.from || process.env.RESEND_FROM_EMAIL?.trim() || "";
  if (!from || /[\r\n\0]/.test(from)) throw new AdminEmailError(400, "Set a sender on this template in Resend.");
  const subject = line(validated.subject);
  if (campaign && options.persistSignOff) requireUnsubscribe(validated.html);
  if (!signOff) return { ...validated, from, subject };
  const signOffImage = await prepareAdminEmailSignOff(actor, signOff.text, options.persistSignOff === true);
  const rendered = renderResendEmailTemplate(template, { ...edits, signOff }, { campaign, signOffImage });
  return { ...rendered, from, subject };
}
function requireUnsubscribe(html: string) {
  if (!/href\s*=\s*["']\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}["']/i.test(html)) {
    throw new AdminEmailError(400, "This design needs a Resend unsubscribe link before it can be used for a campaign. Add it to the template in Resend.");
  }
}
type Recipient = { email: string; name: string };
async function resolveRecipients(input: { mode: string; segmentId?: string; topicId?: string; recipients?: string[] }) {
  const suppressed = new Set((await all<{ id: string; email: string }>("/suppressions", 10000)).map(item => item.email.toLowerCase()));
  if (input.mode === "individual") {
    if (!Array.isArray(input.recipients) || input.recipients.length !== 1 || typeof input.recipients[0] !== "string" || !isAdminEmailAddress(input.recipients[0].trim())) throw new AdminEmailError(400, "Add one valid recipient email address.");
    const email = input.recipients[0].trim().toLowerCase();
    let contact: { unsubscribed: boolean; first_name: string | null; last_name: string | null } | undefined;
    try { contact = await provider(`/contacts/${encodeURIComponent(email)}`); } catch (error) { if (!(error instanceof AdminEmailError) || error.status !== 404) throw error; }
    if (suppressed.has(email) || contact?.unsubscribed) throw new AdminEmailError(400, "This recipient has unsubscribed or is suppressed in Resend.");
    return { recipients: [{ email, name: [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") }], excludedCount: 0, segmentName: "Individual email" };
  }
  const segmentId = id(input.segmentId), topicId = id(input.topicId);
  const segment = await provider<{ name: string }>(`/segments/${segmentId}`);
  const topic = await provider<Topic>(`/topics/${topicId}`);
  const contacts = await all<{ id: string; email: string; first_name: string | null; last_name: string | null; unsubscribed: boolean }>(`/segments/${segmentId}/contacts`);
  const recipients: Recipient[] = [];
  const seen = new Set<string>();
  for (const contact of contacts) {
    const email = contact.email.toLowerCase();
    if (contact.unsubscribed || suppressed.has(email) || seen.has(email)) continue;
    const topics = await all<{ id: string; subscription: string }>(`/contacts/${contact.id}/topics`);
    const preference = topics.find(item => item.id === topicId)?.subscription ?? topic.default_subscription;
    if (preference !== "opt_in") continue;
    recipients.push({ email, name: [contact.first_name, contact.last_name].filter(Boolean).join(" ") }); seen.add(email);
  }
  recipients.sort((a, b) => a.email.localeCompare(b.email));
  return { recipients, excludedCount: contacts.length - recipients.length, segmentName: segment.name };
}
type Snapshot = { mode: "individual" | "campaign"; subject: string; html: string; text: string; from: string; replyTo: string[];
  segmentId?: string; topicId?: string; recipients: Recipient[]; segmentName: string; excludedCount: number;
  broadcastId?: string; broadcastHash?: string };
function broadcastHash(item: GetBroadcastResponseSuccess) { return digest({ ...item, object: undefined, created_at: undefined }); }
async function campaignPayload(actor: string, input: Record<string, unknown>) {
  const segmentId = id(input.segmentId), topicId = id(input.topicId);
  if (typeof input.name === "string") line(input.name);
  const rendered = await prepareResendEmail(actor, input, { persistSignOff: true });
  requireUnsubscribe(rendered.html);
  return { name: line(input.name, rendered.subject), segment_id: segmentId, topic_id: topicId, from: rendered.from,
    subject: rendered.subject, html: rendered.html, text: rendered.text, ...(rendered.replyTo.length ? { reply_to: rendered.replyTo } : {}), send: false };
}
async function audit(actor: string, action: string, subjectId: string, metadata: Record<string, string>) {
  await getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, actor);
    await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,metadata)
      values(${actor}::uuid,${action},'resend_email',${subjectId},${tx.json(metadata)}::jsonb)`;
  });
}
export async function saveResendBroadcast(actor: string, input: Record<string, unknown>) {
  if (input.mode !== "campaign") throw new AdminEmailError(400, "Choose a campaign to save a Resend draft.");
  const payload = await campaignPayload(actor, input);
  // A save never sends and never changes contact preferences or segments.
  const created = await provider<{ id: string }>("/broadcasts", "POST", payload);
  await audit(actor, "resend_email.draft_created", created.id, { templateId: id(input.templateId) });
  return created;
}
export async function reviewResendEmail(actor: string, input: Record<string, unknown>) {
  await assertAdminEmailAccess(actor);
  let snapshot: Snapshot;
  if (input.broadcastId || input.mode === "campaign") {
    let broadcastId = input.broadcastId ? id(input.broadcastId) : "";
    if (!broadcastId) broadcastId = (await saveResendBroadcast(actor, input)).id;
    const item = await provider<GetBroadcastResponseSuccess>(`/broadcasts/${broadcastId}`);
    if (item.status !== "draft") throw new AdminEmailError(409, "This campaign is already queued or sent in Resend.");
    if (!item.html || !item.from || !item.subject) throw new AdminEmailError(400, "Complete this campaign's content and sender in Resend first.");
    requireUnsubscribe(item.html);
    const segmentId = id(item.segment_id ?? item.audience_id), topicId = id(item.topic_id);
    const resolved = await resolveRecipients({ mode: "campaign", segmentId, topicId });
    snapshot = { mode: "campaign", subject: item.subject, html: item.html, text: item.text ?? "", from: item.from, replyTo: item.reply_to ?? [],
      segmentId, topicId, ...resolved, broadcastId, broadcastHash: broadcastHash(item) };
  } else {
    const resolved = await resolveRecipients({ mode: "individual", recipients: input.recipients as string[] });
    const rendered = await prepareResendEmail(actor, input, { persistSignOff: true });
    snapshot = { mode: "individual", ...rendered, ...resolved };
  }
  if (!snapshot.recipients.length) throw new AdminEmailError(400, "No eligible recipients. Check this audience's topic subscriptions in Resend.");
  const review = await getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, actor, true);
    const [row] = await tx<Array<{ id: string; expires_at: Date }>>`insert into admin_resend_reviews(actor_auth_user_id,snapshot,recipient_hash)
      values(${actor}::uuid,${tx.json(snapshot)}::jsonb,${digest(snapshot.recipients)}) returning id,expires_at`;
    return row;
  });
  return { id: review.id, ...snapshot, recipientCount: snapshot.recipients.length, expiresAt: new Date(review.expires_at).toISOString() };
}
type ReviewRow = { id: string; actor_auth_user_id: string; snapshot: Snapshot; recipient_hash: string; status: string; provider_id: string | null; expires_at: Date | string };
export async function sendResendEmail(actor: string, reviewId: unknown) {
  const reviewKey = id(reviewId);
  await assertAdminEmailAccess(actor);
  if (!getResendEmailConfiguration().sendingReady) throw new AdminEmailError(503, "Sending is disabled until email setup is complete.");
  const db = getApplicationDatabase();
  const [review] = await db<ReviewRow[]>`select * from admin_resend_reviews where id=${reviewKey}::uuid and actor_auth_user_id=${actor}::uuid`;
  if (!review) throw new AdminEmailError(404, "Email review not found.");
  const result = (status: string, providerId: string | null) => ({ status: status === "sent" ? (review.snapshot.mode === "campaign" ? "queued" : "sent") : "unknown", id: providerId ?? review.snapshot.broadcastId ?? review.id,
    message: status === "sent" ? "Accepted by Resend. Delivery status appears in sending history." : "The sending result is not confirmed. Check Resend before sending this email again." });
  if (review.status === "rejected") throw new AdminEmailError(409, "Resend rejected this send. Correct the email in Resend and review it again.");
  if (review.status !== "reviewed") return result(review.status, review.provider_id);
  if (new Date(review.expires_at).getTime() < Date.now()) throw new AdminEmailError(409, "This review expired. Review the email again.");
  const snapshot = review.snapshot;
  const resolved = await resolveRecipients({ ...snapshot, recipients: snapshot.recipients.map(item => item.email) });
  if (digest(resolved.recipients) !== review.recipient_hash) throw new AdminEmailError(409, "The audience or subscription preferences changed. Review recipients again.");
  if (snapshot.broadcastId) {
    const current = await provider<GetBroadcastResponseSuccess>(`/broadcasts/${snapshot.broadcastId}`);
    if (broadcastHash(current) !== snapshot.broadcastHash) throw new AdminEmailError(409, "This campaign changed in Resend. Review it again before sending.");
  }
  // Commit a one-way claim BEFORE any provider send. Uncertain sends are never automatically retried.
  const claimed = await db.begin(async tx => {
    await requireAdminEmailActor(tx, actor, true);
    if (snapshot.broadcastId) {
      await tx`select pg_advisory_xact_lock(hashtextextended(${`resend-broadcast:${snapshot.broadcastId}`},0))`;
      const previous = await tx`select id from admin_resend_reviews
        where snapshot->>'broadcastId'=${snapshot.broadcastId} and status in ('sending','sent','unknown') limit 1`;
      if (previous.length) return false;
    }
    const rows = await tx`update admin_resend_reviews set status='sending',attempted_at=clock_timestamp()
      where id=${reviewKey}::uuid and actor_auth_user_id=${actor}::uuid and status='reviewed' and expires_at>clock_timestamp() returning id`;
    return rows.length > 0;
  });
  if (!claimed) return result("unknown", null);
  let providerId: string;
  try {
    const sent = snapshot.broadcastId
      ? await provider<{ id: string }>(`/broadcasts/${snapshot.broadcastId}/send`, "POST", {})
      : await provider<{ id: string }>("/emails", "POST", { from: snapshot.from, to: snapshot.recipients.map(item => item.email),
        subject: snapshot.subject, html: snapshot.html, text: snapshot.text, ...(snapshot.replyTo.length ? { reply_to: snapshot.replyTo } : {}) }, `ruined-resend-review/${reviewKey}`);
    providerId = sent.id;
    if (!providerId) throw new Error("Missing provider ID");
  } catch (error) {
    if (error instanceof AdminEmailError && [400, 404, 422].includes(error.status)) {
      await db`update admin_resend_reviews set status='rejected' where id=${reviewKey}::uuid and status='sending'`;
      throw error;
    }
    await db`update admin_resend_reviews set status='unknown' where id=${reviewKey}::uuid and status='sending'`;
    return result("unknown", null);
  }
  await db.begin(async tx => {
    await tx`update admin_resend_reviews set status='sent',provider_id=${providerId},completed_at=clock_timestamp() where id=${reviewKey}::uuid`;
    await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,metadata)
      values(${actor}::uuid,'resend_email.sent','resend_email',${reviewKey},${tx.json({ providerId, mode: snapshot.mode, recipientCount: snapshot.recipients.length })}::jsonb)`;
  });
  return result("sent", providerId);
}
