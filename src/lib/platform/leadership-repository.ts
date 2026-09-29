import "server-only";
import type postgres from "postgres";
import { getBillingDatabase } from "@/lib/stripe/database";
import { OpsRepositoryError, requireOpsAdmin, writeOpsAudit } from "@/lib/platform/ops-repository";
import { LEADERSHIP_LABELS, LEADERSHIP_RESPONSIBILITIES, parseLeadershipCommand, type LeadershipDirectory, type LeadershipResponsibility } from "@/lib/platform/leadership-model";
export class LeadershipRepositoryError extends OpsRepositoryError {}

export async function requireLeadershipResponsibility(tx: postgres.TransactionSql, actorAuthUserId: string, capability: LeadershipResponsibility): Promise<void> {
  // Serialize against grants/revocation and operator access changes. Call before
  // acquiring member/Circle/service locks throughout the leadership workflow.
  await tx`select pg_advisory_xact_lock(hashtext('ruined-operator-admins'), 1)`;
  const rows = await tx<Array<{ allowed: boolean }>>`select private.ruined_has_leadership_responsibility(${actorAuthUserId}::uuid, ${capability}) as allowed`;
  if (!rows[0]?.allowed) throw new LeadershipRepositoryError("forbidden", `An Administrator must assign you ${LEADERSHIP_LABELS[capability].toLowerCase()} responsibility in Leadership before you can do this.`);
}
const iso = (value: Date | string) => new Date(value).toISOString();
const day = (value: Date | string) => iso(value).slice(0, 10);

async function requireLeadershipReader(tx: postgres.TransactionSql, actor: string) {
  const rows = await tx<Array<{ admin: boolean; capabilities: string[] }>>`
    select exists(select 1 from platform_role_grants role_grant where role_grant.auth_user_id = account.auth_user_id and role_grant.role_slug = 'ops_admin' and role_grant.revoked_at is null) as admin,
      array(select grant_row.capability from leadership_responsibility_grants grant_row where grant_row.auth_user_id = account.auth_user_id and grant_row.revoked_at is null) as capabilities
    from platform_users account
    where account.auth_user_id = ${actor}::uuid and account.status = 'active'
      and exists(select 1 from platform_role_grants role_grant where role_grant.auth_user_id = account.auth_user_id and role_grant.role_slug = 'ops_admin' and role_grant.revoked_at is null)
  `;
  const row = rows[0];
  if (!row || (!row.admin && !row.capabilities.length)) throw new LeadershipRepositoryError("forbidden", "Leadership responsibility is required to view these private records.");
  return { canConfigure: row.admin, capabilities: row.capabilities.filter((v): v is LeadershipResponsibility => LEADERSHIP_RESPONSIBILITIES.includes(v as LeadershipResponsibility)) };
}

async function requireEligibleSupporter(tx: postgres.TransactionSql, authUserId: string, circleId: string) {
  const rows = await tx<Array<{ auth_user_id: string }>>`
    select account.auth_user_id from platform_users account
    join ruined_members member on member.id = account.member_id and member.person_id = account.person_id
    join people person on person.id = member.person_id
    join member_lifecycle lifecycle on lifecycle.member_id = member.id
    join circle_member_assignments placement on placement.member_id = member.id
    join circles circle on circle.id = placement.circle_id
    where account.auth_user_id = ${authUserId}::uuid and account.status = 'active' and person.status = 'active'
      and lifecycle.account_state = 'active' and lifecycle.administrative_onboarding_state = 'completed'
      and lifecycle.program_state in ('active','onboarding') and lifecycle.foundations_state = 'completed'
      and (lifecycle.standing_state = 'active' or (lifecycle.standing_state = 'cancellation_requested' and lifecycle.cancellation_effective_at > statement_timestamp()))
      and ((coalesce(private.ruined_member_shared_billing_state(member.id), lifecycle.billing_state) = 'active'
        and member.membership_state = 'active') or private.ruined_member_has_complimentary_funding(member.id))
      and exists(select 1 from platform_role_grants access where access.auth_user_id = account.auth_user_id and access.role_slug = 'member' and access.revoked_at is null)
      and circle.id = ${circleId}::uuid and circle.status in ('active','forming')
      and placement.ended_at is null and placement.assigned_at <= statement_timestamp()
    for update of account, member, person, lifecycle, placement, circle
  `;
  if (!rows[0]) throw new LeadershipRepositoryError("conflict", "Choose an active member of this Circle who has completed membership entry and Foundations. Supporter service does not include free membership.");
}

async function startService(tx: postgres.TransactionSql, actor: string, authUserId: string, circleId: string, temporary: boolean, reason: string) {
  await requireEligibleSupporter(tx, authUserId, circleId);
  const readiness = await tx<Array<{ id: string }>>`select id from supporter_readiness_approvals where auth_user_id = ${authUserId}::uuid and circle_id = ${circleId}::uuid for share`;
  if (!readiness[0]) throw new LeadershipRepositoryError("conflict", "Approve this member’s readiness for this Circle before starting service.");
  const current = await tx<Array<{ id: string }>>`select id::text from circle_staff_assignments where circle_id = ${circleId}::uuid and role_slug = 'circle_leader' and ended_at is null for update`;
  if (current[0]) throw new LeadershipRepositoryError("conflict", "This Circle already has an active Supporter. End their service first.");
  // Service scope reuses the existing staff-assignment permission system. The
  // internal role identifier is retained; it grants no complimentary funding.
  await tx`insert into platform_role_grants(auth_user_id,role_slug,granted_by_auth_user_id)
    select ${authUserId}::uuid,'circle_leader',${actor}::uuid
    where not exists(select 1 from platform_role_grants where auth_user_id = ${authUserId}::uuid and role_slug in ('circle_leader','ops_admin') and revoked_at is null)`;
  const inserted = await tx<Array<{ id: string }>>`
    insert into circle_staff_assignments(circle_id,auth_user_id,role_slug,assigned_by_auth_user_id)
    values (${circleId}::uuid,${authUserId}::uuid,'circle_leader',${actor}::uuid) returning id::text
  `;
  const id = inserted[0].id;
  await tx`insert into supporter_service_details(assignment_id,readiness_id,temporary,reason) values (${id}::bigint,${readiness[0].id}::uuid,${temporary},${reason})`;
  await writeOpsAudit(tx, { action: "supporter.service_started", actorAuthUserId: actor, subjectType: "circle_staff_assignment", subjectId: id, reason, after: { authUserId, circleId, temporary, readinessId: readiness[0].id } });
  return id;
}

export async function executeLeadershipCommand(actorAuthUserId: string, input: unknown) {
  let command: ReturnType<typeof parseLeadershipCommand>;
  try { command = parseLeadershipCommand(input); } catch (error) { throw new LeadershipRepositoryError("invalid_request", error instanceof Error ? error.message : "Check the request."); }
  const sql = getBillingDatabase();
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('ruined-operator-admins'), 1)`;
    const audit = (action: string, subjectType: string, subjectId: string, after?: postgres.JSONValue, before?: postgres.JSONValue) => writeOpsAudit(tx, { action, actorAuthUserId, subjectType, subjectId, reason: command.reason, after, before });
    if (command.action === "grant" || command.action === "revoke") {
      await requireOpsAdmin(tx, actorAuthUserId);
      if (command.action === "grant") {
        const recipient = await tx<Array<{ auth_user_id: string }>>`
          select account.auth_user_id from platform_users account where account.auth_user_id = ${command.authUserId}::uuid and account.status = 'active'
          and exists (select 1 from platform_role_grants role_grant where role_grant.auth_user_id = account.auth_user_id and role_grant.role_slug = 'ops_admin' and role_grant.revoked_at is null) for update
        `;
        if (!recipient[0]) throw new LeadershipRepositoryError("invalid_request", "Assign responsibility to an active Administrator account.");
        const rows = await tx<Array<{ id: string }>>`insert into leadership_responsibility_grants(auth_user_id,capability,granted_by_auth_user_id,reason) values (${command.authUserId}::uuid,${command.capability},${actorAuthUserId}::uuid,${command.reason}) on conflict (auth_user_id,capability) where revoked_at is null do nothing returning id`;
        if (!rows[0]) throw new LeadershipRepositoryError("conflict", "This operator already has that responsibility.");
        await audit("leadership.responsibility_granted", "leadership_responsibility", rows[0].id, { authUserId: command.authUserId, capability: command.capability });
      } else {
        const rows = await tx<Array<{ id: string }>>`update leadership_responsibility_grants set revoked_at = statement_timestamp(), revoked_by_auth_user_id = ${actorAuthUserId}::uuid, revoke_reason = ${command.reason} where auth_user_id = ${command.authUserId}::uuid and capability = ${command.capability} and revoked_at is null returning id`;
        if (!rows[0]) throw new LeadershipRepositoryError("conflict", "That responsibility is no longer active.");
        await audit("leadership.responsibility_revoked", "leadership_responsibility", rows[0].id, undefined, { authUserId: command.authUserId, capability: command.capability });
      }
      return { action: command.action };
    }
    if (command.action === "ready" || command.action === "start" || command.action === "end") {
      await requireLeadershipResponsibility(tx, actorAuthUserId, "supporter_readiness");
      if (command.action === "ready") {
        await requireEligibleSupporter(tx, command.authUserId, command.circleId);
        const rows = await tx<Array<{ id: string }>>`insert into supporter_readiness_approvals(auth_user_id,circle_id,approved_by_auth_user_id,reason) values (${command.authUserId}::uuid,${command.circleId}::uuid,${actorAuthUserId}::uuid,${command.reason}) on conflict(auth_user_id,circle_id) do nothing returning id`;
        if (!rows[0]) throw new LeadershipRepositoryError("conflict", "Readiness for this Circle has already been approved.");
        await audit("supporter.readiness_approved", "supporter_readiness", rows[0].id, { authUserId: command.authUserId, circleId: command.circleId });
      } else if (command.action === "start") {
        await startService(tx, actorAuthUserId, command.authUserId, command.circleId, command.temporary, command.reason);
      } else {
        const rows = await tx<Array<{ id: string; circle_id: string; auth_user_id: string }>>`select id::text,circle_id,auth_user_id from circle_staff_assignments where id = ${command.assignmentId}::bigint and role_slug = 'circle_leader' and ended_at is null for update`;
        const service = rows[0];
        if (!service) throw new LeadershipRepositoryError("conflict", "This Supporter service has already ended.");
        if (command.coverAuthUserId === service.auth_user_id) throw new LeadershipRepositoryError("invalid_request", "Choose a different member for temporary coverage.");
        await tx`update circle_staff_assignments set ended_at = statement_timestamp(), ended_by_auth_user_id = ${actorAuthUserId}::uuid, end_reason = ${command.reason} where id = ${service.id}::bigint`;
        await audit("supporter.service_ended", "circle_staff_assignment", service.id, { temporaryCoverageAuthUserId: command.coverAuthUserId }, { authUserId: service.auth_user_id, circleId: service.circle_id });
        if (command.coverAuthUserId) await startService(tx, actorAuthUserId, command.coverAuthUserId, service.circle_id, true, command.reason);
        // End scoped access immediately; retain other Circle assignments and all
        // unrelated permissions, membership entitlements, and billing history.
        await tx`update platform_role_grants set revoked_at = statement_timestamp(), revoke_reason = 'Supporter service ended'
          where auth_user_id = ${service.auth_user_id}::uuid and role_slug = 'circle_leader' and revoked_at is null
            and not exists(select 1 from circle_staff_assignments remaining where remaining.auth_user_id = ${service.auth_user_id}::uuid and remaining.role_slug = 'circle_leader' and remaining.ended_at is null)`;
      }
      return { action: command.action };
    }
    await requireLeadershipResponsibility(tx, actorAuthUserId, "reimbursements");
    if (command.action === "request_reimbursement") {
      const services = await tx<Array<{ id: string; assigned_at: string; ended_at: string | null }>>`select id::text,assigned_at,ended_at from circle_staff_assignments where id = ${command.assignmentId}::bigint and role_slug = 'circle_leader' for update`;
      const service = services[0];
      if (!service || command.periodStart < day(service.assigned_at) || command.periodEnd > day(service.ended_at ?? new Date().toISOString()) || command.periodEnd > day(new Date().toISOString())) throw new LeadershipRepositoryError("invalid_request", "Choose an elapsed period within this Supporter’s active service. Historical service can be reimbursed after stepping down.");
      const overlaps = await tx<Array<{ id: string }>>`select reimbursement.id from supporter_reimbursements reimbursement join circle_staff_assignments prior_service on prior_service.id = reimbursement.assignment_id where prior_service.auth_user_id = (select auth_user_id from circle_staff_assignments where id = ${command.assignmentId}::bigint) and reimbursement.status <> 'rejected' and period_start <= ${command.periodEnd}::date and period_end >= ${command.periodStart}::date`;
      if (overlaps[0]) throw new LeadershipRepositoryError("conflict", "A reimbursement already covers part of this service period. Review the existing record first.");
      const rows = await tx<Array<{ id: string }>>`insert into supporter_reimbursements(assignment_id,period_start,period_end,amount_minor,currency,reason,requested_by_auth_user_id) values (${command.assignmentId}::bigint,${command.periodStart}::date,${command.periodEnd}::date,${command.amountMinor},${command.currency},${command.reason},${actorAuthUserId}::uuid) returning id`;
      await audit("supporter.reimbursement_requested", "supporter_reimbursement", rows[0].id, { assignmentId: command.assignmentId, periodStart: command.periodStart, periodEnd: command.periodEnd, amountMinor: command.amountMinor, currency: command.currency });
    } else if (command.action === "approve" || command.action === "reject" || command.action === "process") {
      const rows = await tx<Array<{ id: string; status: string; decided_at: string | null }>>`select id,status,decided_at from supporter_reimbursements where id = ${command.reimbursementId}::uuid for update`;
      const record = rows[0];
      if (!record) throw new LeadershipRepositoryError("not_found", "This reimbursement could not be found.");
      if (command.action === "process") {
        if (record.status !== "approved") throw new LeadershipRepositoryError("conflict", "Only an approved reimbursement can be marked processed.");
        if (command.processedAt > day(new Date().toISOString()) || command.processedAt < day(record.decided_at!)) throw new LeadershipRepositoryError("invalid_request", "The processing date must fall between approval and today.");
        const duplicate = await tx<Array<{ id: string }>>`select id from supporter_reimbursements where lower(btrim(payment_reference)) = lower(${command.reference}) and status = 'processed'`;
        if (duplicate[0]) throw new LeadershipRepositoryError("conflict", "That payment reference is already recorded.");
        await tx`update supporter_reimbursements set status = 'processed', processed_by_auth_user_id = ${actorAuthUserId}::uuid, processed_at = ${command.processedAt}::date, payment_reference = ${command.reference}, processing_reason = ${command.reason} where id = ${record.id}::uuid`;
        await audit("supporter.reimbursement_processed", "supporter_reimbursement", record.id, { status: "processed", reference: command.reference, processedAt: command.processedAt }, { status: record.status });
      } else {
        if (record.status !== "pending") throw new LeadershipRepositoryError("conflict", "This reimbursement has already been decided.");
        const status = command.action === "approve" ? "approved" : "rejected";
        await tx`update supporter_reimbursements set status = ${status}, decided_by_auth_user_id = ${actorAuthUserId}::uuid, decided_at = statement_timestamp(), decision_reason = ${command.reason} where id = ${record.id}::uuid`;
        await audit(`supporter.reimbursement_${status}`, "supporter_reimbursement", record.id, { status }, { status: record.status });
      }
    }
    return { action: command.action };
  });
}

export async function getLeadershipDirectory(actorAuthUserId: string): Promise<LeadershipDirectory> {
  const sql = getBillingDatabase();
  return sql.begin(async (tx) => {
    const access = await requireLeadershipReader(tx, actorAuthUserId);
    const people = await tx<Array<{ auth_user_id: string; name: string; email: string; operator: boolean; circle_ids: string[] }>>`
      select account.auth_user_id,coalesce(profile.display_name,profile.preferred_name,account.email_normalized) as name,account.email_normalized as email,
      exists(select 1 from platform_role_grants g where g.auth_user_id = account.auth_user_id and g.role_slug = 'ops_admin' and g.revoked_at is null) as operator,
      array(select placement.circle_id from circle_member_assignments placement where placement.member_id = account.member_id and placement.ended_at is null and placement.assigned_at <= statement_timestamp()) as circle_ids
      from platform_users account left join person_profiles profile on profile.person_id = account.person_id where account.status = 'active' order by name,account.auth_user_id
    `;
    const grants = await tx<Array<{ id: string; auth_user_id: string; capability: LeadershipResponsibility }>>`select id,auth_user_id,capability from leadership_responsibility_grants where revoked_at is null order by capability,granted_at`;
    const circles = await tx<Array<{ id: string; name: string }>>`select id,name from circles where status in ('active','forming') order by name`;
    const readiness = await tx<Array<{ id: string; auth_user_id: string; circle_id: string; approved_at: string; reason: string }>>`select id,auth_user_id,circle_id,approved_at,reason from supporter_readiness_approvals order by approved_at desc`;
    const services = await tx<Array<{ id: string; auth_user_id: string; name: string; circle_id: string; circle_name: string; assigned_at: string; ended_at: string | null; temporary: boolean; reason: string | null }>>`
      select staff.id::text,staff.auth_user_id,coalesce(profile.display_name,profile.preferred_name,account.email_normalized) as name,
        staff.circle_id,circle.name as circle_name,staff.assigned_at,staff.ended_at,coalesce(details.temporary,false) as temporary,coalesce(staff.end_reason,details.reason) as reason
      from circle_staff_assignments staff join circles circle on circle.id = staff.circle_id
      join platform_users account on account.auth_user_id = staff.auth_user_id left join person_profiles profile on profile.person_id = account.person_id
      left join supporter_service_details details on details.assignment_id = staff.id
      where staff.role_slug = 'circle_leader' order by staff.ended_at nulls first,staff.assigned_at desc
    `;
    // Service coordinators do not gain private financial records merely through
    // readiness responsibility. Administrators can configure owners, not read payments.
    const reimbursements = access.capabilities.includes("reimbursements") ? await tx<Array<{ id: string; assignment_id: string; period_start: string; period_end: string; amount_minor: number; currency: string; status: "pending" | "approved" | "rejected" | "processed"; reason: string; decision_reason: string | null; payment_reference: string | null; processed_at: string | null }>>`select id,assignment_id::text,period_start,period_end,amount_minor,currency,status,reason,decision_reason,payment_reference,processed_at from supporter_reimbursements order by requested_at desc` : [];
    return {
      ...access,
      people: people.map(p => ({ authUserId: p.auth_user_id, name: p.name, email: p.email, operator: p.operator, circleIds: p.circle_ids })),
      grants: grants.map(g => ({ id: g.id, authUserId: g.auth_user_id, name: people.find(p => p.auth_user_id === g.auth_user_id)?.name ?? "Inactive operator", capability: g.capability })), circles,
      readiness: readiness.map(r => ({ id: r.id, authUserId: r.auth_user_id, circleId: r.circle_id, approvedAt: iso(r.approved_at), reason: r.reason })),
      services: services.map(s => ({ id: s.id, authUserId: s.auth_user_id, name: s.name, circleId: s.circle_id, circleName: s.circle_name, startedAt: iso(s.assigned_at), endedAt: s.ended_at ? iso(s.ended_at) : null, temporary: s.temporary, reason: s.reason })),
      reimbursements: reimbursements.map(r => ({ id: r.id, assignmentId: r.assignment_id, name: services.find(s => s.id === r.assignment_id)?.name ?? "Historical Supporter", circleName: services.find(s => s.id === r.assignment_id)?.circle_name ?? "Historical Circle", periodStart: day(r.period_start), periodEnd: day(r.period_end), amountMinor: Number(r.amount_minor), currency: r.currency, status: r.status, reason: r.reason, decisionReason: r.decision_reason, reference: r.payment_reference, processedAt: r.processed_at ? day(r.processed_at) : null })),
    };
  });
}
