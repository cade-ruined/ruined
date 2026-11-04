import "server-only";
import type { Sql, TransactionSql } from "postgres";
import { MEMBER_SMS_TEMPLATE_IDS, MemberSmsTemplateError, type MemberSmsTemplateConfig, type MemberSmsTemplateId } from "./member-sms-template-model";

/** Missing configuration is an error; never silently send default text after a failed read. */
export async function readMemberSmsTemplates(tx: Sql | TransactionSql, lock = false): Promise<MemberSmsTemplateConfig[]> {
  const rows = await tx<MemberSmsTemplateConfig[]>`select id,body,enabled,notice_minutes as "noticeMinutes",revision,
    to_char(effective_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "effectiveAt",
    to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt",updated_by as "updatedBy"
    from private.member_sms_templates order by id ${lock ? tx`for share` : tx``}`;
  if (rows.length !== MEMBER_SMS_TEMPLATE_IDS.length || MEMBER_SMS_TEMPLATE_IDS.some(id => !rows.some(row => row.id === id))) {
    throw new MemberSmsTemplateError(503, "Saved text templates are unavailable.");
  }
  return MEMBER_SMS_TEMPLATE_IDS.map(id => rows.find(row => row.id === id)!);
}
export async function memberSmsTemplateRevisionAllowed(tx: TransactionSql, id: MemberSmsTemplateId, revision: number): Promise<boolean> {
  const [row] = await tx`select id from private.member_sms_templates where id=${id} and revision=${revision} and enabled for share`;
  return Boolean(row);
}
