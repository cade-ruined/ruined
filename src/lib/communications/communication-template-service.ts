import "server-only";
import { getApplicationDatabase } from "@/lib/database/server";
import { getRegistrationEditableTemplate, validateRegistrationTemplateOverride, type RegistrationMessageKind } from "@/lib/membership/registration-email";
import { AdminEmailError } from "./admin-email-model";
import { requireAdminEmailActor } from "./admin-email-repository";
import { findManualCommunicationTemplate } from "./cade-communications";

export function communicationTemplateDefaults(key: unknown) {
  if (typeof key !== "string") throw new AdminEmailError(400,"Choose an email template.");
  if (key.startsWith("manual:")) {
    const template=findManualCommunicationTemplate(key.slice(7));
    if (template) return {key,subject:template.subject,body:template.body,tokens:[] as string[],channel:template.channel};
  }
  if (["registration:welcome","registration:pre_foundations","registration:profile_ready"].includes(key)) {
    return {key,...getRegistrationEditableTemplate(key.slice(13) as RegistrationMessageKind),channel:"emails" as const};
  }
  throw new AdminEmailError(404,"That editable template is unavailable.");
}
export function validateCommunicationTemplate(input: Record<string,unknown>) {
  const defaults=communicationTemplateDefaults(input.key);
  if (typeof input.subject!=="string" || typeof input.body!=="string" || !input.body.trim()
    || (defaults.channel==="emails" && !input.subject.trim()) || input.subject.length>200 || input.body.length>12000
    || /[\r\n\x00<>]/.test(input.subject) || /[\x00<>]/.test(input.body)) {
    throw new AdminEmailError(400,"Add a plain-text subject and message within the length limits.");
  }
  if (!Number.isInteger(input.revision) || Number(input.revision)<0) throw new AdminEmailError(400,"Refresh the template before saving.");
  if (defaults.key.startsWith("registration:")) {
    try { validateRegistrationTemplateOverride(defaults.key.slice(13) as RegistrationMessageKind,{subject:input.subject,body:input.body}); }
    catch(error) { throw new AdminEmailError(400,error instanceof Error ? error.message : "Review the template fields."); }
    const text=input.subject+"\n"+input.body;
    for (const match of text.matchAll(/\{\{[^{}]+\}\}/g)) if (!defaults.tokens.includes(match[0])) throw new AdminEmailError(400,`Unsupported field: ${match[0]}`);
    if (/[{}]/.test(text.replace(/\{\{[a-z_]+\}\}/g,""))) throw new AdminEmailError(400,"Use only the listed template fields.");
  }
  return {...defaults,subject:input.subject.trim(),body:input.body.trim(),revision:Number(input.revision)};
}
export async function readCommunicationTemplate(actor: string, key: unknown) {
  const defaults=communicationTemplateDefaults(key);
  return getApplicationDatabase().begin(async tx=>{
    await requireAdminEmailActor(tx,actor);
    const [installed]=await tx`select to_regclass('private.member_communication_template_overrides') is not null as installed`;
    if (!installed?.installed) throw new AdminEmailError(503,"Template editing needs setup.");
    const [row]=await tx`select subject,body,revision from private.member_communication_template_overrides where key=${defaults.key}`;
    return {...defaults,...row,revision:row?.revision ?? 0};
  });
}
export async function updateCommunicationTemplate(actor: string, input: Record<string,unknown>) {
  const template=validateCommunicationTemplate(input);
  return getApplicationDatabase().begin(async tx=>{
    await requireAdminEmailActor(tx,actor,true);
    await tx`select pg_advisory_xact_lock(hashtext('communications-template:' || ${template.key}))`;
    const [saved]=await tx`select revision from private.member_communication_template_overrides where key=${template.key} for update`;
    if ((saved?.revision ?? 0)!==template.revision) throw new AdminEmailError(409,"This template changed. Refresh before saving.");
    const [row]=await tx`insert into private.member_communication_template_overrides(key,subject,body,revision,updated_by)
      values(${template.key},${template.subject},${template.body},1,${actor}::uuid)
      on conflict(key) do update set subject=excluded.subject,body=excluded.body,
        revision=private.member_communication_template_overrides.revision+1,updated_by=excluded.updated_by,updated_at=clock_timestamp()
      returning subject,body,revision`;
    await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,metadata)
      values(${actor}::uuid,'communications.template_updated','communication_template',${template.key},${tx.json({previousRevision:template.revision,revision:row.revision})})`;
    return {...template,...row};
  });
}
