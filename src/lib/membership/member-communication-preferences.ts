import "server-only";

import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import {
  MEMBER_COMMUNICATION_NOTICE_VERSION, MEMBER_EMAIL_UPDATES_NOTICE, MEMBER_SMS_UPDATES_NOTICE, MEMBER_SMS_UPDATES_DETAIL,
  type MemberCommunicationPreferencesInput, type MemberCommunicationPreferencesSnapshot,
} from "./member-communication-preferences-model";

const CONTEXT = "member_communication_preferences_v1";
const channels = ["email", "sms"] as const;
type Channel = typeof channels[number];
type Decision = { id: string; channel: Channel; decision: "accepted" | "withdrawn"; destination: string; requestFingerprint: string | null };
type Destinations = { email: string; phone: string | null };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class MemberCommunicationPreferencesError extends Error {
  constructor(readonly status: number, message: string,
    readonly code?: "communication_preferences_changed" | "communication_notice_changed" | "sms_opt_in_required") {
    super(message); this.name = "MemberCommunicationPreferencesError";
  }
}

async function readState(sql: Sql | TransactionSql, memberId: string, destinations: Destinations) {
  const rows = await sql<Array<Decision>>`select distinct on (evidence->>'channel') id::text,
      evidence->>'channel' as channel,decision,evidence->>'destination' as destination,
      evidence->>'requestFingerprint' as "requestFingerprint"
    from member_consents where member_id=${memberId}::uuid and consent_type='communications'
      and evidence->>'context'=${CONTEXT} and evidence->>'purpose'='membership_updates'
      and evidence->>'channel' in ('email','sms') order by evidence->>'channel',member_consents.id desc`;
  const latest = Object.fromEntries(rows.map(row => [row.channel, row])) as Partial<Record<Channel, Decision>>;
  const value = (channel: Channel, destination: string | null): boolean | null => {
    const decision = latest[channel];
    if (!decision) return null;
    return decision.decision === "accepted" && Boolean(destination) && decision.destination === destination;
  };
  const snapshot: MemberCommunicationPreferencesSnapshot = {
    email: value("email", destinations.email), sms: value("sms", destinations.phone),
    smsPhone: latest.sms?.destination ?? null,
    revision: hash([CONTEXT, memberId, destinations.email, destinations.phone,
      ...channels.map(channel => latest[channel] ? [latest[channel]!.id, latest[channel]!.decision, latest[channel]!.destination] : null)]),
  };
  return { latest, snapshot };
}

/** No defaults are stored here. Null means this member has never chosen. */
export async function getMemberCommunicationPreferences(sql: Sql | TransactionSql, memberId: string,
  destinations: Destinations): Promise<MemberCommunicationPreferencesSnapshot> {
  return (await readState(sql, memberId, destinations)).snapshot;
}

/** Caller holds the member lock. No provider calls, subscriptions, or outbox work. */
export async function saveMemberCommunicationPreferences(tx: TransactionSql,
  member: { memberId: string; personId: string; authUserId: string; email: string; phone: string },
  input: MemberCommunicationPreferencesInput | undefined): Promise<void> {
  if (input === undefined) return;
  if (!input || typeof input.email !== "boolean" || typeof input.sms !== "boolean"
    || typeof input.expectedRevision !== "string" || input.expectedRevision.length > 80) {
    throw new MemberCommunicationPreferencesError(400, "Choose your email and text preferences.");
  }
  if (input.noticeVersion !== MEMBER_COMMUNICATION_NOTICE_VERSION) {
    throw new MemberCommunicationPreferencesError(409, "The communication notice has changed. Reload before saving your preferences.", "communication_notice_changed");
  }
  const [identity] = await tx<Array<{ phone: string | null; verified: boolean }>>`select profile.mobile_e164 as phone,
    exists(select 1 from person_email_addresses email where email.person_id=identity.person_id
      and email.email_normalized=identity.email_normalized and email.verification_state='verified' and email.retired_at is null) as verified
    from platform_users identity
    left join person_private_profiles profile on profile.person_id=identity.person_id
    where identity.auth_user_id=${member.authUserId}::uuid and identity.person_id=${member.personId}::uuid
      and (identity.member_id is null or identity.member_id=${member.memberId}::uuid) and identity.status='active'
      and identity.email_normalized=${member.email}`;
  if (!identity?.verified) throw new MemberCommunicationPreferencesError(403, "Verify your email before saving communication preferences.");
  const { latest, snapshot } = await readState(tx, member.memberId, { email: member.email, phone: identity.phone });
  const destinations = { email: member.email, sms: member.phone };
  const matches = (channel: Channel) => latest[channel]?.destination === destinations[channel]
    && latest[channel]?.decision === (input[channel] ? "accepted" : "withdrawn");
  const fingerprint = hash([CONTEXT, member.memberId, input.expectedRevision, input.noticeVersion,
    input.email, input.sms, member.email, member.phone]);
  if (snapshot.revision !== input.expectedRevision) {
    // A lost response can retry the exact committed choice, but a stale form
    // must never restore a withdrawal or overwrite another tab's decision.
    if (identity.phone === member.phone && channels.every(matches)
      && channels.some(channel => latest[channel]?.requestFingerprint === fingerprint)) return;
    throw new MemberCommunicationPreferencesError(409, "Your communication preferences changed. Reload before saving them.", "communication_preferences_changed");
  }
  if (input.sms && (identity.phone !== member.phone || !matches("sms")) && input.smsOptIn?.phone !== member.phone) {
    throw new MemberCommunicationPreferencesError(400, "Select text reminders again to confirm this phone number.", "sms_opt_in_required");
  }
  for (const channel of channels) {
    // Returning to an earlier number still records the new active confirmation.
    if (matches(channel) && !(channel === "sms" && input.sms && identity.phone !== member.phone)) continue;
    const enabled = input[channel];
    const notice = channel === "email" ? MEMBER_EMAIL_UPDATES_NOTICE : `${MEMBER_SMS_UPDATES_NOTICE} ${MEMBER_SMS_UPDATES_DETAIL}`;
    await tx`insert into member_consents(member_id,consent_type,policy_version,decision,accepted_at,source,actor_auth_user_id,evidence,dedupe_key)
      values(${member.memberId}::uuid,'communications',${MEMBER_COMMUNICATION_NOTICE_VERSION},${enabled ? "accepted" : "withdrawn"},
        statement_timestamp(),'member',${member.authUserId}::uuid,
        ${tx.json({ context: CONTEXT, purpose: "membership_updates", channel, destination: destinations[channel], notice,
          requested: enabled, requestFingerprint: fingerprint,
          action: enabled ? channel === "sms" ? "sms_checkbox_checked" : "email_preference_on_at_submission" : "preference_off_at_submission",
          destinationVerified: channel === "email", marketingConsent: false,
          emailDefaultMayBePreselected: channel === "email" && !latest.email,
        })}::jsonb,${`member-reminders:${member.memberId}:${channel}:${fingerprint}`}) on conflict(dedupe_key) do nothing`;
  }
}
