import "server-only";
import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { getMemberCommunicationPreferences } from "@/lib/membership/member-communication-preferences";
import { parseFoundationsBillingSchedule } from "@/lib/membership/foundations-schedule";
import { AdminEmailError, isAdminEmailAddress } from "./admin-email-model";
import { requireAdminEmailActor } from "./admin-email-repository";
import { classifyMemberSegment, readMemberSegmentSource } from "./member-segment-sync";
import { readCadenceEvent, readCadenceRecipients } from "./member-email-cadence-repository";
import { EMAIL_GROUP_MEMBER_LIMIT, EMAIL_GROUP_SEARCH_LIMIT, emailGroupId, emailGroupRevision,
  emailGroupRuleSummary, normalizeEmailGroupInput, type EmailGroupDetail,
  type EmailGroupMember, type EmailGroupPeoplePage, type EmailGroupPurpose, type EmailGroupRule,
  type EmailGroupRuleOptions, type EmailGroupSummary } from "./email-group-model";

type Row = { id: string; name: string; description: string; mode: "manual" | "rule"; rule: EmailGroupRule | null;
  revision: number; archived_at: Date | string | null; updated_at: Date | string };
type PersonRow = { email: string; name: string; memberId: string | null; personId: string | null };
const iso = (value: Date | string) => new Date(value).toISOString();
const person = (row: PersonRow): EmailGroupMember => ({ email: row.email, name: row.name,
  ...(row.memberId ? { memberId: row.memberId } : {}), ...(row.personId ? { personId: row.personId } : {}) });
function bounded(members: EmailGroupMember[]): EmailGroupMember[] {
  if (members.length > EMAIL_GROUP_MEMBER_LIMIT) throw new AdminEmailError(400, `This group exceeds ${EMAIL_GROUP_MEMBER_LIMIT} contacts. Choose a narrower rule or selection.`);
  const unique = new Map<string, EmailGroupMember>();
  for (const member of members) {
    const email = member.email.trim().toLowerCase();
    if (isAdminEmailAddress(email)) unique.set(email, { ...member, email });
  }
  return [...unique.values()].sort((a, b) => a.email.localeCompare(b.email));
}
function summary(row: Row, memberCount: number | null): EmailGroupSummary {
  return { id: row.id, name: row.name, description: row.description, mode: row.mode, revision: row.revision,
    archivedAt: row.archived_at ? iso(row.archived_at) : null, updatedAt: iso(row.updated_at), memberCount,
    ruleSummary: emailGroupRuleSummary(row.rule) };
}

/** A picker projection, not a consent decision. Retired and erased identities cannot be revived by another source. */
async function knownPeople(tx: TransactionSql, options: { emails?: string[]; query?: string; limit?: number } = {}): Promise<EmailGroupMember[]> {
  const emails = options.emails ? tx.json(options.emails) : null, query = options.query ?? "";
  const rows = await tx<PersonRow[]>`with candidates as (
    select member.email_normalized as email,coalesce(profile.display_name,'') as name,0 as priority
      from ruined_members member join people identity on identity.id=member.person_id and identity.status='active'
      left join person_profiles profile on profile.person_id=member.person_id where member.deleted_at is null
    union all select address.email_normalized,coalesce(profile.display_name,''),1 from person_email_addresses address
      join people identity on identity.id=address.person_id and identity.status='active'
      left join person_profiles profile on profile.person_id=address.person_id where address.retired_at is null
    union all select contact.email_normalized,coalesce(profile.display_name,''),2 from communication_contacts contact
      left join people identity on identity.id=contact.person_id left join person_profiles profile on profile.person_id=contact.person_id
      where contact.person_id is null or identity.status='active'
    union all select registration.email_normalized,registration.registrant_name,3 from community_event_registrations registration where registration.status='registered'
    union all select waitlist.email_normalized,waitlist.name,4 from membership_waitlist waitlist where waitlist.joined_waitlist_at is not null
  ), selected as (
    select distinct on (email) email,name from candidates
    where (${emails}::jsonb is null or email in (select jsonb_array_elements_text(${emails}::jsonb)))
      and (${query}='' or position(${query} in lower(email))>0 or position(${query} in lower(name))>0)
      and not exists(select 1 from person_email_addresses retired left join people identity on identity.id=retired.person_id
        where retired.email_normalized=candidates.email and (retired.retired_at is not null or identity.status<>'active'))
      and not exists(select 1 from ruined_members deleted where deleted.email_normalized=candidates.email and deleted.deleted_at is not null)
      and not exists(select 1 from communication_contacts contact join people identity on identity.id=contact.person_id
        where contact.email_normalized=candidates.email and identity.status<>'active')
    order by email,priority,name
  ) select selected.email,selected.name,member.id as "memberId",coalesce(member.person_id,address.person_id,contact.person_id) as "personId"
    from selected left join ruined_members member on member.email_normalized=selected.email and member.deleted_at is null
    left join person_email_addresses address on address.email_normalized=selected.email and address.retired_at is null
    left join communication_contacts contact on contact.email_normalized=selected.email
    order by selected.email limit ${options.limit ?? EMAIL_GROUP_MEMBER_LIMIT + 1}`;
  return rows.map(person);
}
async function paidCohort(tx: TransactionSql, cohortMonth?: string): Promise<EmailGroupMember[]> {
  const rows = await tx<Array<{ email: string; billingPlan: "monthly" | "annual"; schedule: unknown }>>`
    select member.email_normalized as email,reservation.billing_plan as "billingPlan",reservation.billing_schedule as schedule
    from member_registration_access registration join ruined_members member on member.id=registration.member_id and member.deleted_at is null
    join people identity on identity.id=member.person_id and identity.status='active'
    join membership_commercial_reservations reservation on reservation.id=private.ruined_member_paid_reservation(member.id)
    where registration.registered_at is not null
      and (${cohortMonth ?? null}::text is null or reservation.billing_schedule->>'cohortMonth'=${cohortMonth ?? null})
      and exists(select 1 from person_email_addresses address where address.person_id=member.person_id
        and address.email_normalized=member.email_normalized and address.verification_state='verified' and address.retired_at is null)
    order by member.id limit ${EMAIL_GROUP_MEMBER_LIMIT + 1}`;
  if (rows.length > EMAIL_GROUP_MEMBER_LIMIT) return bounded(rows.map(row => ({ email: row.email, name: "" })));
  const valid = rows.filter(row => { const schedule = parseFoundationsBillingSchedule(row.schedule, row.billingPlan); return schedule && (!cohortMonth || schedule.cohortMonth === cohortMonth); });
  return valid.length ? bounded(await knownPeople(tx, { emails: valid.map(row => row.email) })) : [];
}
async function canonicalRegisteredEmails(tx: TransactionSql, state: "all" | "waiting" | "open", email?: string): Promise<string[]> {
  // The existing canonical selector predates paid_membership. Only extend its registration proof with the current provider-evidence function.
  if (!email) {
    const [count] = await tx<Array<{ count: number }>>`select count(*)::integer as count from ruined_members`;
    if (count.count > 10000) throw new AdminEmailError(400, "The member directory is too large for this group rule. Use a cohort or call audience.");
  }
  const source = await readMemberSegmentSource(tx, email);
  const paid = await tx<Array<{ email: string }>>`select member.email_normalized as email from ruined_members member
    join member_registration_access registration on registration.member_id=member.id
    where registration.completion_basis='paid_membership' and registration.registered_at is not null
      and (${email ?? null}::text is null or member.email_normalized=${email ?? null})
      and registration.payment_reservation_id=private.ruined_member_paid_reservation(member.id)`;
  const paidEmails = new Set(paid.map(row => row.email));
  const selected = source.filter(member => {
    const classified = classifyMemberSegment({ ...member, real_registration: member.real_registration || paidEmails.has(member.email) });
    return (classified === "waiting" || classified === "open") && (state === "all" || classified === state);
  });
  return selected.map(member => member.email);
}
async function registeredMembers(tx: TransactionSql, state: "all" | "waiting" | "open"): Promise<EmailGroupMember[]> {
  const emails = await canonicalRegisteredEmails(tx, state);
  bounded(emails.map(email => ({ email, name: "" })));
  return emails.length ? bounded(await knownPeople(tx, { emails })) : [];
}
async function resolveRule(tx: TransactionSql, rule: EmailGroupRule): Promise<EmailGroupMember[]> {
  if (rule.kind === "registered_members") return registeredMembers(tx, rule.state);
  if (rule.kind === "foundations_cohort") return paidCohort(tx, rule.cohortMonth);
  if (rule.kind === "call_audience") {
    const event = await readCadenceEvent(tx, rule.callEventId);
    if (!event) return [];
    try {
      const recipients = await readCadenceRecipients(tx, event, "members");
      const emails = recipients.filter(row => row.eligible).map(row => row.email);
      return emails.length ? bounded(await knownPeople(tx, { emails })) : [];
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "roster_exceeds_review_limit") throw new AdminEmailError(400, "This call exceeds its 500-member audience review limit.");
      throw error;
    }
  }
  const rows = rule.kind === "general_subscribers" ? await tx<Array<{ email: string }>>`
    select contact.email_normalized as email from communication_contacts contact join communication_subscriptions subscription on subscription.contact_id=contact.id
    where subscription.channel='email' and subscription.topic='about' and subscription.status='subscribed' and subscription.confirmed_at is not null
    order by contact.email_normalized limit ${EMAIL_GROUP_MEMBER_LIMIT + 1}` : await tx<Array<{ email: string }>>`
    select email_normalized as email from community_event_registrations where event_key=${rule.eventKey} and status='registered'
    order by email_normalized limit ${EMAIL_GROUP_MEMBER_LIMIT + 1}`;
  bounded(rows.map(row => ({ email: row.email, name: "" })));
  return rows.length ? bounded(await knownPeople(tx, { emails: rows.map(row => row.email) })) : [];
}
async function resolveRow(tx: TransactionSql, row: Row, tolerateLimit = false): Promise<EmailGroupDetail> {
  try {
  let members: EmailGroupMember[];
  if (row.mode === "rule") members = await resolveRule(tx, row.rule!);
  else {
    const entries = await tx<Array<{ email: string; memberId: string | null; personId: string | null }>>`select email_normalized as email,member_id as "memberId",person_id as "personId" from private.admin_email_group_entries where group_id=${row.id}::uuid order by email_normalized limit ${EMAIL_GROUP_MEMBER_LIMIT + 1}`;
    bounded(entries.map(entry => ({ email: entry.email, name: "" })));
    members = entries.length ? bounded((await knownPeople(tx, { emails: entries.map(entry => entry.email) })).filter(member => {
      const saved = entries.find(entry => entry.email === member.email)!;
      return (!saved.memberId || saved.memberId === member.memberId) && (!saved.personId || saved.personId === member.personId);
    })) : [];
  }
  return { group: summary(row, members.length), rule: row.rule, members };
  } catch (error) {
    if (!tolerateLimit || !(error instanceof AdminEmailError) || error.status !== 400) throw error;
    return { group: { ...summary(row, null), issue: error.message }, rule: row.rule, members: [] };
  }
}
async function getRow(tx: TransactionSql, id: string, lock = false): Promise<Row> {
  const [row] = await tx<Row[]>`select * from private.admin_email_groups where id=${id}::uuid ${lock ? tx`for update` : tx``}`;
  if (!row) throw new AdminEmailError(404, "This email group was not found.");
  return row;
}
async function validateMembers(tx: TransactionSql, input: ReturnType<typeof normalizeEmailGroupInput>) {
  if (input.mode === "rule") {
    if (input.rule!.kind === "call_audience" && !await readCadenceEvent(tx, input.rule!.callEventId)) throw new AdminEmailError(400, "Choose a current published member call.");
    if (input.rule!.kind === "event_registrants") {
      const rows = await tx`select event_key from community_event_listings where event_key=${input.rule!.eventKey}`;
      if (!rows.length) throw new AdminEmailError(400, "Choose an existing community event.");
    }
    return resolveRule(tx, input.rule!);
  }
  const members = input.members.length ? bounded(await knownPeople(tx, { emails: input.members.map(member => member.email) })) : [];
  if (members.length !== input.members.length || input.members.some(entry => {
    const current = members.find(member => member.email === entry.email);
    return !current || entry.memberId && entry.memberId !== current.memberId || entry.personId && entry.personId !== current.personId;
  })) throw new AdminEmailError(409, "A selected contact changed or is no longer available. Choose current contacts again.");
  return members;
}
async function audit(tx: TransactionSql, actor: string, action: string, row: Row, count?: number) {
  await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,metadata)
    values(${actor}::uuid,${action},'email_group',${row.id},${tx.json({ revision: row.revision, mode: row.mode, ...(count === undefined ? {} : { memberCount: count }) })}::jsonb)`;
}

export async function listEmailGroups(actor: string, options: { includeArchived?: boolean } = {}): Promise<EmailGroupSummary[]> {
  return getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, actor);
    const rows = await tx<Row[]>`select * from private.admin_email_groups where (${options.includeArchived === true} or archived_at is null) order by lower(name),id limit 201`;
    if (rows.length > 200) throw new AdminEmailError(400, "Too many archived groups to display. Hide archived groups to continue.");
    const result = [];
    for (const row of rows) result.push((await resolveRow(tx, row, true)).group);
    return result;
  });
}
export async function getEmailGroup(actor: string, value: unknown): Promise<EmailGroupDetail> {
  return getApplicationDatabase().begin(async tx => { await requireAdminEmailActor(tx, actor); return resolveRow(tx, await getRow(tx, emailGroupId(value)), true); });
}
export async function resolveEmailGroup(actor: string, value: unknown, expectedRevision?: number) {
  return getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, actor);
    const row = await getRow(tx, emailGroupId(value));
    if (row.archived_at || expectedRevision !== undefined && row.revision !== emailGroupRevision(expectedRevision)) throw new AdminEmailError(409, "This group changed or was archived. Review it again.");
    const { group, members } = await resolveRow(tx, row); return { group, members };
  });
}
export async function previewEmailGroup(actor: string, value: unknown): Promise<EmailGroupDetail> {
  return getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, actor);
    const input = normalizeEmailGroupInput(value), members = await validateMembers(tx, input);
    return { group: summary({ ...input, id: input.id ?? "preview", revision: input.revision ?? 0, archived_at: null, updated_at: new Date() }, members.length), rule: input.rule, members };
  });
}
export async function saveEmailGroup(actor: string, value: unknown): Promise<EmailGroupDetail> {
  const input = normalizeEmailGroupInput(value);
  return getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, actor, true);
    await tx`select pg_advisory_xact_lock(hashtext('ruined-email-groups'))`;
    const existing = input.id ? await getRow(tx, input.id, true) : null;
    if (existing && (existing.archived_at || existing.revision !== input.revision)) throw new AdminEmailError(409, "This group changed or was archived. Reload before editing.");
    const duplicates = await tx`select id from private.admin_email_groups where archived_at is null and lower(name)=lower(${input.name}) and id<>coalesce(${input.id ?? null}::uuid,'00000000-0000-0000-0000-000000000000'::uuid)`;
    if (duplicates.length) throw new AdminEmailError(409, "Another active group already has this name.");
    if (!existing) {
      const [count] = await tx<Array<{ count: number }>>`select count(*)::integer as count from private.admin_email_groups where archived_at is null`;
      if (count.count >= 100) throw new AdminEmailError(400, "Archive an unused group before creating another. Up to 100 active groups are supported.");
    }
    const members = await validateMembers(tx, input);
    const [row] = existing ? await tx<Row[]>`update private.admin_email_groups set name=${input.name},description=${input.description},mode=${input.mode},rule=${input.rule ? tx.json(input.rule) : null}::jsonb,
      revision=revision+1,updated_by=${actor}::uuid,updated_at=clock_timestamp() where id=${existing.id}::uuid returning *`
      : await tx<Row[]>`insert into private.admin_email_groups(name,description,mode,rule,created_by,updated_by)
        values(${input.name},${input.description},${input.mode},${input.rule ? tx.json(input.rule) : null}::jsonb,${actor}::uuid,${actor}::uuid) returning *`;
    await tx`delete from private.admin_email_group_entries where group_id=${row.id}::uuid`;
    if (input.mode === "manual" && members.length) await tx`insert into private.admin_email_group_entries(group_id,email_normalized,display_name,member_id,person_id,added_by)
      select ${row.id}::uuid,entry.email,entry.name,entry."memberId",entry."personId",${actor}::uuid
      from jsonb_to_recordset(${tx.json(members)}::jsonb) as entry(email text,name text,"memberId" uuid,"personId" uuid)`;
    await audit(tx, actor, existing ? "email_group.updated" : "email_group.created", row, members.length);
    return { group: summary(row, members.length), rule: row.rule, members };
  });
}
export async function archiveEmailGroup(actor: string, value: unknown, revision: unknown, archived: unknown): Promise<EmailGroupDetail> {
  const id = emailGroupId(value), expected = emailGroupRevision(revision);
  if (typeof archived !== "boolean") throw new AdminEmailError(400, "Choose archive or restore.");
  return getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, actor, true);
    await tx`select pg_advisory_xact_lock(hashtext('ruined-email-groups'))`;
    const current = await getRow(tx, id, true);
    if (current.revision !== expected) throw new AdminEmailError(409, "This group changed. Reload before continuing.");
    if (Boolean(current.archived_at) === archived) return resolveRow(tx, current, true);
    if (!archived) {
      const duplicates = await tx`select id from private.admin_email_groups where archived_at is null and lower(name)=lower(${current.name})`;
      if (duplicates.length) throw new AdminEmailError(409, "An active group already uses this name. Rename it before restoring this group.");
      const [count] = await tx<Array<{ count: number }>>`select count(*)::integer as count from private.admin_email_groups where archived_at is null`;
      if (count.count >= 100) throw new AdminEmailError(400, "Archive another group before restoring this one.");
    }
    const [row] = await tx<Row[]>`update private.admin_email_groups set archived_at=case when ${archived} then clock_timestamp() else null end,
      revision=revision+1,updated_by=${actor}::uuid,updated_at=clock_timestamp() where id=${id}::uuid returning *`;
    await audit(tx, actor, archived ? "email_group.archived" : "email_group.restored", row);
    return resolveRow(tx, row, true);
  });
}
export async function searchEmailGroupPeople(actor: string, value: unknown): Promise<EmailGroupPeoplePage> {
  if (typeof value !== "string" || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) throw new AdminEmailError(400, "Search by name or email using up to 120 characters.");
  return getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, actor);
    const matches = await knownPeople(tx, { query: value.trim().toLowerCase(), limit: EMAIL_GROUP_SEARCH_LIMIT + 1 });
    return { members: matches.slice(0, EMAIL_GROUP_SEARCH_LIMIT), hasMore: matches.length > EMAIL_GROUP_SEARCH_LIMIT };
  });
}
export async function listEmailGroupRuleOptions(actor: string): Promise<EmailGroupRuleOptions> {
  return getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, actor);
    const events = await tx<Array<{ eventKey: string; name: string }>>`select event_key as "eventKey",title as name from community_event_listings order by starts_at desc,event_key limit 250`;
    const calls = await tx<Array<{ id: string; name: string }>>`select id,title || ' · ' || to_char(starts_at at time zone timezone,'YYYY-MM-DD HH24:MI') || ' ' || timezone as name from experiences
      where status='published' and cancelled_at is null and starts_at>statement_timestamp() and ends_at>starts_at
        and visibility<>'public' and registration_mode<>'external' and kind in ('weekly_call','circle_meeting','academy_session','member_event') order by starts_at,id limit 250`;
    const cohorts = await tx<Array<{ cohortMonth: string; name: string }>>`select distinct reservation.billing_schedule->>'cohortMonth' as "cohortMonth",
      reservation.billing_schedule->>'cohortMonth' || ' Foundations' as name from member_registration_access registration
      join membership_commercial_reservations reservation on reservation.id=private.ruined_member_paid_reservation(registration.member_id)
      where registration.registered_at is not null and reservation.billing_schedule->>'cohortMonth' ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
      order by "cohortMonth" desc limit 100`;
    return { events, calls, cohorts };
  });
}

/** The worker holds this share lock through its claim; a concurrent group edit or archive cannot cross it. */
export async function requireEmailGroupRevision(tx: TransactionSql, value: unknown, revision: unknown): Promise<void> {
  const id = emailGroupId(value), expected = emailGroupRevision(revision);
  const rows = await tx`select id from private.admin_email_groups where id=${id}::uuid and revision=${expected} and archived_at is null for share`;
  if (!rows.length) throw new AdminEmailError(409, "This group changed or was archived. Review the audience again.");
}
/** Permission is independent of membership in a group. No provider state or consent is changed. */
export async function checkEmailGroupRecipientPermissionInTransaction(tx: TransactionSql, value: string, purpose: EmailGroupPurpose,
  options: { lock?: boolean; expectedIdentity?: Pick<EmailGroupMember, "memberId" | "personId"> } = {}): Promise<boolean> {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!isAdminEmailAddress(email) || !["general_updates", "membership_updates"].includes(purpose)) return false;
  const lock = options.lock !== false;
  // Lock the reviewed identity before contact evidence. A retired or reassigned
  // address must not carry an already reviewed message to a different person.
  if (lock && options.expectedIdentity) {
    if (options.expectedIdentity.memberId) {
      await tx`select private.ruined_lock_member_complimentary_funding(${options.expectedIdentity.memberId}::uuid)`;
      await tx`select private.ruined_lock_member_operator_funding(${options.expectedIdentity.memberId}::uuid)`;
      await tx`select id from ruined_members where id=${options.expectedIdentity.memberId}::uuid for update`;
    }
    if (options.expectedIdentity.personId) {
      await tx`select id from people where id=${options.expectedIdentity.personId}::uuid for share`;
      await tx`select id from person_email_addresses where person_id=${options.expectedIdentity.personId}::uuid and email_normalized=${email} for share`;
    }
  }
  const [member] = purpose === "membership_updates" ? await tx<Array<{ id: string; personId: string }>>`select member.id,member.person_id as "personId" from ruined_members member
    join people identity on identity.id=member.person_id and identity.status='active'
    join member_lifecycle lifecycle on lifecycle.member_id=member.id and lifecycle.account_state not in ('closed','suspended')
    where member.email_normalized=${email} and member.deleted_at is null limit 1` : [];
  if (purpose === "membership_updates" && !member) return false;
  // Consent writers and cadence dispatch take the member lock before contact evidence.
  if (lock && member) {
    await tx`select private.ruined_lock_member_complimentary_funding(${member.id}::uuid)`;
    await tx`select private.ruined_lock_member_operator_funding(${member.id}::uuid)`;
    await tx`select id from ruined_members where id=${member.id}::uuid for update`;
  }
  if (lock) await tx`select id from communication_contacts where email_normalized=${email} for share`;
  if (options.expectedIdentity) {
    const [current] = await knownPeople(tx, { emails: [email] });
    if (!current || (current.memberId ?? null) !== (options.expectedIdentity.memberId ?? null)
      || (current.personId ?? null) !== (options.expectedIdentity.personId ?? null)) return false;
  }
  const suppressed = await tx`select id from communication_contacts where email_normalized=${email} and delivery_state<>'active'`;
  if (suppressed.length) return false;
  const erasedContact = await tx`select contact.id from communication_contacts contact join people identity on identity.id=contact.person_id
    where contact.email_normalized=${email} and identity.status<>'active'`;
  if (erasedContact.length) return false;
  const unavailable = await tx`select address.id from person_email_addresses address join people identity on identity.id=address.person_id
    where address.email_normalized=${email} and (address.retired_at is not null or identity.status<>'active')`;
  if (unavailable.length) return false;
  const deleted = await tx`select id from ruined_members where email_normalized=${email} and deleted_at is not null`;
  if (deleted.length) return false;
  if (purpose === "general_updates") {
    const rows = await tx`select subscription.id from communication_subscriptions subscription join communication_contacts contact on contact.id=subscription.contact_id
      where contact.email_normalized=${email} and subscription.channel='email' and subscription.topic='about'
        and subscription.status='subscribed' and subscription.confirmed_at is not null ${lock ? tx`for share of subscription,contact` : tx``}`;
    return rows.length > 0;
  }
  if (!member) return false;
  const rows = await tx`select address.id from person_email_addresses address join platform_users account on account.person_id=address.person_id
      and account.email_normalized=address.email_normalized and account.status='active' and (account.member_id is null or account.member_id=${member.id}::uuid)
    join platform_role_grants grant_row on grant_row.auth_user_id=account.auth_user_id and grant_row.role_slug='member' and grant_row.revoked_at is null
    join ruined_members member on member.id=${member.id}::uuid and member.email_normalized=address.email_normalized and member.deleted_at is null
    join people identity on identity.id=member.person_id and identity.status='active'
    join member_lifecycle lifecycle on lifecycle.member_id=member.id and lifecycle.account_state not in ('closed','suspended')
    where address.person_id=${member.personId}::uuid and address.email_normalized=${email} and address.verification_state='verified' and address.retired_at is null
    ${lock ? tx`for share of address,account,grant_row,identity,lifecycle` : tx``}`;
  if (!rows.length) return false;
  if (!(await canonicalRegisteredEmails(tx, "all", email)).includes(email)) return false;
  return (await getMemberCommunicationPreferences(tx, member.id, { email, phone: null })).email === true;
}
export async function checkEmailGroupRecipientPermission(email: string, purpose: EmailGroupPurpose): Promise<boolean> {
  return getApplicationDatabase().begin(tx => checkEmailGroupRecipientPermissionInTransaction(tx, email, purpose, { lock: false }));
}
