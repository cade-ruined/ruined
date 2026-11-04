import "server-only";
import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { requireAdminEmailActor } from "./admin-email-repository";
import { AdminEmailError } from "./admin-email-model";
import { MemberSmsTemplateError, memberSmsTemplateView, validateMemberSmsTemplateEdit, type MemberSmsTemplateConfig, type MemberSmsTemplateEdit } from "./member-sms-template-model";
import { readMemberSmsTemplates } from "./member-sms-template-repository";

async function authorize(tx: TransactionSql, actor: string, lock = false) {
  try { await requireAdminEmailActor(tx, actor, lock); }
  catch (error) { if (error instanceof AdminEmailError) throw new MemberSmsTemplateError(error.status, "An active administrator must manage text templates."); throw error; }
}
function digest(edit: MemberSmsTemplateEdit, preview: string) {
  return createHash("sha256").update(JSON.stringify({ version: 1, ...edit, preview })).digest("hex");
}
function candidate(current: MemberSmsTemplateConfig, edit: MemberSmsTemplateEdit) {
  if (current.revision !== edit.revision) throw new MemberSmsTemplateError(409, "This template changed. Refresh the saved version and review your draft again.");
  const template = memberSmsTemplateView({ ...current, ...edit });
  return { template, preview: template.preview, reviewDigest: digest(edit, template.preview) };
}
export async function getMemberSmsTemplates(actor: string) {
  return getApplicationDatabase().begin("read only", async tx => {
    await authorize(tx, actor);
    return { templates: (await readMemberSmsTemplates(tx)).map(template => memberSmsTemplateView(template)) };
  });
}
export async function previewMemberSmsTemplate(actor: string, value: unknown) {
  const edit = validateMemberSmsTemplateEdit(value);
  return getApplicationDatabase().begin("read only", async tx => {
    await authorize(tx, actor);
    const current = (await readMemberSmsTemplates(tx)).find(template => template.id === edit.id)!;
    return candidate(current, edit);
  });
}
export async function saveMemberSmsTemplate(actor: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MemberSmsTemplateError(400, "Review the exact template before saving.");
  const { reviewDigest, ...fields } = value as Record<string, unknown>;
  if (typeof reviewDigest !== "string" || !/^[a-f0-9]{64}$/.test(reviewDigest)) throw new MemberSmsTemplateError(400, "Review the exact template before saving.");
  const edit = validateMemberSmsTemplateEdit(fields);
  return getApplicationDatabase().begin(async tx => {
    await tx`set local lock_timeout='3s'`; await tx`set local statement_timeout='10s'`;
    await authorize(tx, actor, true);
    const [current] = await tx<MemberSmsTemplateConfig[]>`select id,body,enabled,notice_minutes as "noticeMinutes",revision,
      effective_at::text as "effectiveAt",updated_at::text as "updatedAt",updated_by as "updatedBy"
      from private.member_sms_templates where id=${edit.id} for update`;
    if (!current) throw new MemberSmsTemplateError(503, "Saved text templates are unavailable.");
    const reviewed = candidate(current, edit);
    if (reviewDigest !== reviewed.reviewDigest) throw new MemberSmsTemplateError(409, "The draft changed after review. Review it again before saving.");
    if (current.body === edit.body && current.enabled === edit.enabled && current.noticeMinutes === edit.noticeMinutes) {
      return { template: memberSmsTemplateView((await readMemberSmsTemplates(tx)).find(template => template.id === edit.id)!), preview: reviewed.preview };
    }
    await tx`update private.member_sms_templates set body=${edit.body},enabled=${edit.enabled},notice_minutes=${edit.noticeMinutes},
      revision=revision+1,effective_at=statement_timestamp(),updated_at=statement_timestamp(),updated_by=${actor}::uuid where id=${edit.id}`;
    const saved = (await readMemberSmsTemplates(tx)).find(template => template.id === edit.id)!;
    await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,before_snapshot,after_snapshot,metadata,dedupe_key)
      values(${actor}::uuid,'member_sms.template_saved','member_sms_template',${edit.id},${tx.json(current)}::jsonb,${tx.json(saved)}::jsonb,
      ${tx.json({ reviewDigest, preview: reviewed.preview })}::jsonb,${`member-sms-template:${edit.id}:${saved.revision}`})`;
    return { template: memberSmsTemplateView(saved), preview: reviewed.preview };
  });
}
