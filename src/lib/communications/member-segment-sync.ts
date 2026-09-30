import type { Sql, TransactionSql } from "postgres";

/** Server/maintenance use only. This reconciles service-email groups; it never
 * sends mail, enrolls a marketing topic, changes access, or resets preferences. */
export type MemberSegment = "waiting" | "open";
export type MemberSegmentConfiguration = {
  enabled: boolean;
  ready: boolean;
  missing: string[];
  segments: Record<MemberSegment, string>;
};
export const MEMBER_SEGMENT_NAMES: Record<MemberSegment, string> = {
  waiting: "Ruined / Registered — awaiting profile access",
  open: "Ruined / Profiles open",
};
const segmentKeys: MemberSegment[] = ["waiting", "open"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const normalizedEmail = (value: string) => value.trim().toLowerCase();

export function getMemberSegmentConfiguration(env: NodeJS.ProcessEnv = process.env): MemberSegmentConfiguration {
  const segments = {
    waiting: env.RESEND_MEMBER_WAITING_SEGMENT_ID?.trim() ?? "",
    open: env.RESEND_MEMBER_PROFILES_OPEN_SEGMENT_ID?.trim() ?? "",
  };
  const enabled = env.RESEND_MEMBER_SEGMENT_SYNC_ENABLED === "true";
  const missing = [
    ...(!env.RESEND_API_KEY?.trim() ? ["RESEND_API_KEY"] : []),
    ...(!env.DATABASE_URL?.trim() ? ["DATABASE_URL"] : []),
    ...(!UUID.test(segments.waiting) ? ["RESEND_MEMBER_WAITING_SEGMENT_ID"] : []),
    ...(!UUID.test(segments.open) ? ["RESEND_MEMBER_PROFILES_OPEN_SEGMENT_ID"] : []),
    ...(segments.waiting && segments.waiting === segments.open ? ["distinct membership segment IDs"] : []),
  ];
  return { enabled, ready: missing.length === 0, missing, segments };
}

export type MemberSegmentSource = {
  email: string;
  name: string;
  account_eligible: boolean;
  verified_identity: boolean;
  profile_complete: boolean;
  registration_hold: boolean;
  registered: boolean;
  profile_open: boolean;
  registration_ready: boolean;
  real_registration: boolean;
  real_existing_access: boolean;
  delivery_eligible: boolean;
};
export type MemberSegmentExclusion = "invalid_email" | "account_unavailable" | "unverified_identity"
  | "profile_incomplete" | "registration_incomplete" | "test_or_unfunded" | "delivery_suppressed";

export function classifyMemberSegment(member: MemberSegmentSource): MemberSegment | MemberSegmentExclusion {
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(member.email) || member.email.length > 254) return "invalid_email";
  if (!member.account_eligible) return "account_unavailable";
  if (!member.verified_identity) return "unverified_identity";
  if (!member.profile_complete) return "profile_incomplete";
  if (!member.delivery_eligible) return "delivery_suppressed";
  if (member.registration_hold) {
    if (!member.registered || !member.registration_ready) return "registration_incomplete";
    if (!member.real_registration) return "test_or_unfunded";
    return member.profile_open ? "open" : "waiting";
  }
  return member.real_existing_access ? "open" : "test_or_unfunded";
}

/** Only the member's current verified email can be exported. No waitlist,
 * invitation-only, event, journal, billing, phone, or address data is exported. */
export async function readMemberSegmentSource(sql: Sql | TransactionSql): Promise<MemberSegmentSource[]> {
  return sql<MemberSegmentSource[]>`
    select member.email_normalized as email,
      coalesce(nullif(btrim(private_profile.legal_name),''),nullif(btrim(profile.display_name),''),'') as name,
      coalesce(member.deleted_at is null and person.status='active'
        and lifecycle.account_state not in ('closed','suspended'),false) as account_eligible,
      exists(select 1 from person_email_addresses email
        join platform_users identity on identity.person_id=email.person_id and identity.email_normalized=email.email_normalized
          and identity.status='active' and (identity.member_id is null or identity.member_id=member.id)
        join platform_role_grants grant_row on grant_row.auth_user_id=identity.auth_user_id
          and grant_row.role_slug='member' and grant_row.revoked_at is null
        where email.person_id=member.person_id and email.email_normalized=member.email_normalized
          and email.verification_state='verified' and email.retired_at is null) as verified_identity,
      onboarding.profile_completed_at is not null as profile_complete,
      registration.member_id is not null as registration_hold,
      registration.registered_at is not null as registered,
      registration.profile_activated_at is not null as profile_open,
      case when registration.member_id is null then false
        else private.ruined_member_registration_ready(member.id) end as registration_ready,
      coalesce((registration.completion_basis='saved_card' and registration.payment_setup_livemode)
        or (registration.completion_basis='complimentary'
          and (private.ruined_member_has_complimentary_funding(member.id)
            or private.ruined_member_has_operator_funding(member.id))),false) as real_registration,
      coalesce(lifecycle.account_state='active' and onboarding.state='completed'
        and lifecycle.administrative_onboarding_state='completed' and lifecycle.program_state in ('onboarding','active')
        and (lifecycle.standing_state='active' or (lifecycle.standing_state='cancellation_requested'
          and lifecycle.cancellation_effective_at>statement_timestamp()))
        and (private.ruined_member_has_complimentary_funding(member.id)
          or private.ruined_member_has_operator_funding(member.id)
          or (coalesce(private.ruined_member_shared_billing_state(member.id),lifecycle.billing_state)='active'
            and (exists(select 1 from stripe_invoices invoice
            join stripe_webhook_events event on event.object_id=invoice.id and event.event_type='invoice.paid'
              and event.livemode and event.status in ('processing','processed')
            where invoice.member_id=member.id and invoice.purpose='membership' and invoice.stripe_status='paid')
            or (private.ruined_member_has_couple_funding(member.id) and exists(
              select 1 from membership_commercial_participants participant
              join membership_commercial_reservations reservation on reservation.id=participant.reservation_id
                and reservation.kind='couple' and reservation.status='activated'
              join stripe_invoices shared_invoice on shared_invoice.stripe_subscription_id=reservation.stripe_subscription_id
                and shared_invoice.member_id=reservation.payer_member_id
                and shared_invoice.purpose='membership' and shared_invoice.stripe_status='paid'
              join stripe_webhook_events shared_event on shared_event.object_id=shared_invoice.id
                and shared_event.event_type='invoice.paid' and shared_event.livemode
                and shared_event.status in ('processing','processed')
              where participant.member_id=member.id and reservation.id=(
                select latest.id from membership_commercial_participants current_participant
                join membership_commercial_reservations latest on latest.id=current_participant.reservation_id
                  and latest.status='activated'
                where current_participant.member_id=member.id order by latest.created_at desc limit 1)
            ))))),false) as real_existing_access,
      not exists(select 1 from communication_contacts contact where contact.email_normalized=member.email_normalized
        and contact.delivery_state<>'active') as delivery_eligible
    from ruined_members member
    left join people person on person.id=member.person_id
    left join member_lifecycle lifecycle on lifecycle.member_id=member.id
    left join member_onboardings onboarding on onboarding.member_id=member.id
    left join member_registration_access registration on registration.member_id=member.id
    left join person_private_profiles private_profile on private_profile.person_id=member.person_id
    left join person_profiles profile on profile.person_id=member.person_id
    order by member.id
  `;
}

export type SegmentContact = { id: string; email: string; first_name: string | null; last_name: string | null; unsubscribed: boolean };
type ContactName = { first_name: string; last_name: string };
export type MemberSegmentProvider = {
  getSegment(id: string): Promise<{ id: string; name: string }>;
  listContacts(segmentId: string, after?: string): Promise<{ data: SegmentContact[]; has_more: boolean }>;
  getContact(email: string): Promise<SegmentContact | null>;
  topicIds(): Promise<string[]>;
  createContact(input: ContactName & { email: string; topics: { id: string; subscription: "opt_out" }[] }): Promise<{ id: string }>;
  updateName(id: string, name: ContactName): Promise<unknown>;
  addToSegment(contactId: string, segmentId: string): Promise<unknown>;
  removeFromSegment(contactId: string, segmentId: string): Promise<unknown>;
};

export class MemberSegmentSyncError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "MemberSegmentSyncError"; }
}

/** A complete snapshot is required before any removals. Broken or repeated
 * pagination must never turn an incomplete read into destructive reconciliation. */
export async function listAllSegmentContacts(provider: MemberSegmentProvider, segmentId: string) {
  const contacts = new Map<string, SegmentContact>();
  const cursors = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < 1_000; page++) {
    const result = await provider.listContacts(segmentId, after);
    if (!Array.isArray(result.data) || typeof result.has_more !== "boolean") throw new MemberSegmentSyncError("invalid_provider_page");
    for (const contact of result.data) {
      if (!contact.id || !contact.email) throw new MemberSegmentSyncError("invalid_provider_contact");
      contacts.set(contact.id, contact);
    }
    if (!result.has_more) return [...contacts.values()];
    const next = result.data.at(-1)?.id;
    if (!next || cursors.has(next)) throw new MemberSegmentSyncError("invalid_provider_cursor");
    cursors.add(next);
    after = next;
  }
  throw new MemberSegmentSyncError("provider_page_limit");
}

function contactName(name: string): ContactName {
  const [first_name = "", ...rest] = name.trim().replace(/\s+/g," ").split(" ");
  return { first_name, last_name: rest.join(" ") };
}

export async function reconcileMemberSegments(input: {
  source: MemberSegmentSource[];
  segments: Record<MemberSegment, string>;
  provider: MemberSegmentProvider;
  apply?: boolean;
  maxNewContacts?: number;
  maxMutations?: number;
}) {
  const { provider, segments } = input;
  if (!segments.waiting || !segments.open || segments.waiting === segments.open) throw new MemberSegmentSyncError("invalid_segment_configuration");
  const report = {
    mode: input.apply ? "apply" : "dry-run", sourceMembers: input.source.length,
    eligible: { waiting: 0, open: 0 }, excluded: {} as Partial<Record<MemberSegmentExclusion, number>>,
    providerUnsubscribed: 0, planned: { creates: 0, nameUpdates: 0, additions: 0, removals: 0 },
    applied: { creates: 0, nameUpdates: 0, additions: 0, removals: 0 }, deferred: 0,
  };
  const desired = new Map<string, { segment: MemberSegment; name: ContactName }>();
  for (const member of input.source) {
    const result = classifyMemberSegment(member);
    if (result !== "waiting" && result !== "open") { report.excluded[result] = (report.excluded[result] ?? 0) + 1; continue; }
    const email = normalizedEmail(member.email);
    if (desired.has(email)) throw new MemberSegmentSyncError("duplicate_member_email");
    desired.set(email, { segment: result, name: contactName(member.name) });
    report.eligible[result]++;
  }
  const owned = new Map<MemberSegment, SegmentContact[]>();
  const known = new Map<string, SegmentContact>();
  for (const key of segmentKeys) {
    // Prevent accidental use of the existing General audience or another group's ID.
    const segment = await provider.getSegment(segments[key]);
    if (segment.id !== segments[key] || segment.name !== MEMBER_SEGMENT_NAMES[key]) throw new MemberSegmentSyncError("segment_name_mismatch");
    const contacts = await listAllSegmentContacts(provider, segments[key]);
    owned.set(key, contacts);
    for (const contact of contacts) known.set(normalizedEmail(contact.email), contact);
  }
  type Operation = { kind: "nameUpdates" | "additions" | "removals"; run: () => Promise<unknown> };
  const operations: Operation[] = [];
  // Remove stale eligibility and wrong-stage memberships before additions.
  for (const key of segmentKeys) for (const contact of owned.get(key)!) {
    if (desired.get(normalizedEmail(contact.email))?.segment !== key) {
      report.planned.removals++;
      operations.push({ kind: "removals", run: () => provider.removeFromSegment(contact.id, segments[key]) });
    }
  }
  const missing: Array<{ email: string; segment: MemberSegment; name: ContactName }> = [];
  let lookups = 0;
  const maxNew = Math.max(1, Math.min(100, input.maxNewContacts ?? 30));
  for (const [email, target] of desired) {
    let contact = known.get(email);
    if (!contact) {
      if (lookups >= maxNew) { report.deferred++; continue; }
      lookups++;
      contact = await provider.getContact(email) ?? undefined;
    }
    if (!contact) { missing.push({ email, ...target }); report.planned.creates++; report.planned.additions++; continue; }
    if (contact.unsubscribed) report.providerUnsubscribed++;
    if (target.name.first_name && (contact.first_name !== target.name.first_name || (contact.last_name ?? "") !== target.name.last_name)) {
      const id = contact.id;
      report.planned.nameUpdates++;
      operations.push({ kind: "nameUpdates", run: () => provider.updateName(id, target.name) });
    }
    if (!owned.get(target.segment)!.some(existing => existing.id === contact.id)) {
      const id = contact.id;
      report.planned.additions++;
      operations.push({ kind: "additions", run: () => provider.addToSegment(id, segments[target.segment]) });
    }
  }
  if (!input.apply) return report;
  let mutations = 0;
  const maxMutations = Math.max(1, Math.min(200, input.maxMutations ?? 60));
  for (const operation of operations) {
    if (mutations >= maxMutations) { report.deferred++; continue; }
    await operation.run();
    report.applied[operation.kind]++;
    mutations++;
  }
  // A newly created service contact must not inherit any default marketing opt-in.
  // Existing contacts never enter this topic-writing path and no operation sets
  // `unsubscribed: false`, including concurrent-create recovery.
  const topics = missing.length && mutations < maxMutations
    ? (await provider.topicIds()).map(id => ({ id, subscription: "opt_out" as const })) : [];
  for (const member of missing) {
    if (mutations + 2 > maxMutations) { report.deferred++; continue; }
    let contact = await provider.getContact(member.email);
    if (!contact) {
      try {
        const created = await provider.createContact({ email: member.email, ...member.name, topics });
        contact = { id: created.id, email: member.email, ...member.name, unsubscribed: false };
        report.applied.creates++;
        mutations++;
      } catch (error) {
        // Another writer or an uncertain network outcome may already have
        // created it. Read back; never repair by resetting consent/preferences.
        contact = await provider.getContact(member.email);
        if (!contact) throw error;
      }
    }
    await provider.addToSegment(contact.id, segments[member.segment]);
    report.applied.additions++;
    mutations++;
  }
  return report;
}

/** Fixed-origin, paced, abortable API calls. Provider errors are intentionally
 * replaced with codes so API response text cannot leak recipient data to logs. */
export function createMemberSegmentProvider(apiKey: string): MemberSegmentProvider {
  let nextCall = 0;
  async function request<T>(path: string, method = "GET", body?: object, allowMissing = false): Promise<T> {
    const wait = nextCall - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    nextCall = Date.now() + 600;
    const response = await fetch(`https://api.resend.com${path}`, {
      method, headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8_000),
    });
    if (allowMissing && response.status === 404) return null as T;
    if (!response.ok) throw new MemberSegmentSyncError(`provider_${response.status}`);
    return await response.json() as T;
  }
  return {
    getSegment: id => request(`/segments/${encodeURIComponent(id)}`),
    listContacts: (id, after) => request(`/segments/${encodeURIComponent(id)}/contacts?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`),
    getContact: email => request(`/contacts/${encodeURIComponent(email)}`, "GET", undefined, true),
    topicIds: async () => (await request<{ data: { id: string }[] }>("/topics")).data.map(topic => topic.id),
    createContact: body => request("/contacts", "POST", body),
    updateName: (id, body) => request(`/contacts/${encodeURIComponent(id)}`, "PATCH", body),
    addToSegment: (id, segment) => request(`/contacts/${encodeURIComponent(id)}/segments/${encodeURIComponent(segment)}`, "POST"),
    removeFromSegment: (id, segment) => request(`/contacts/${encodeURIComponent(id)}/segments/${encodeURIComponent(segment)}`, "DELETE"),
  };
}

/** Advisory transaction lock prevents overlapping cron/manual reconcilers.
 * No source records or consent rows are changed by this maintenance task. */
export async function runMemberSegmentSync(sql: Sql, options: { apply?: boolean; env?: NodeJS.ProcessEnv } = {}) {
  const env = options.env ?? process.env;
  const config = getMemberSegmentConfiguration(env);
  if (!config.ready || (options.apply && !config.enabled)) return {
    enabled: config.enabled, ready: config.ready, missing: config.missing,
    skipped: options.apply && !config.enabled ? "disabled" : "configuration", mode: options.apply ? "apply" : "dry-run",
  };
  return sql.begin(async tx => {
    const [lock] = await tx`select pg_try_advisory_xact_lock(193741,8301) as acquired`;
    if (!lock.acquired) return { enabled: config.enabled, ready: true, skipped: "busy" };
    const source = await readMemberSegmentSource(tx);
    const result = await reconcileMemberSegments({ source, segments: config.segments,
      provider: createMemberSegmentProvider(env.RESEND_API_KEY!.trim()), apply: options.apply });
    return { enabled: config.enabled, ready: true, ...result };
  });
}
