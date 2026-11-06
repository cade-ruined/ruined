import "server-only";
import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { isFoundationsLaunched } from "@/lib/foundations/availability";
import { AdminEmailError } from "@/lib/communications/admin-email-model";
import { requireAdminEmailActor } from "@/lib/communications/admin-email-repository";
import { getMemberEmailCadenceDeliveryConfiguration, assertCadencePayload } from "@/lib/communications/member-email-cadence-delivery";
import { reviewCadenceProviderRecipients } from "@/lib/communications/member-email-cadence-provider";
import { checkEmailGroupRecipientPermissionInTransaction } from "@/lib/communications/email-group-repository";
import { readLifecycleMembers, type LifecycleMember } from "@/lib/communications/member-lifecycle-email-repository";
import { isPracticeReleaseCourse, PRACTICE_RECAPS, PRACTICE_RECAP_VERSION, PRACTICE_TIME_RELEASE_AT, type PracticeReleaseCourse, type PracticeReleaseOverview, type PracticeReleaseReview } from "./release-model";
import { renderPracticeRecap } from "./release-email";

export async function readPracticeReleaseRecipients(tx: TransactionSql, memberId?: string, lock = false): Promise<LifecycleMember[]> {
  const members = await readLifecycleMembers(tx, memberId, lock);
  const rows = await tx<Array<{ id: string; personId: string }>>`select member.id,member.person_id as "personId" from ruined_members member
    where member.deleted_at is null and private.ruined_member_profile_released(member.id)
      and (${memberId ?? null}::uuid is null or member.id=${memberId ?? null}::uuid)`;
  const released = new Map(rows.map(row => [row.id, row]));
  const recipients: LifecycleMember[] = [];
  for (const member of members) {
    const identity = released.get(member.id);
    // A completed, funded registration can receive service emails while its
    // administrative Foundations onboarding is still in progress. Use the same
    // current permission evidence as membership-update campaigns, not the
    // broader participation capabilities used by lifecycle automations.
    const eligible = Boolean(identity) && await checkEmailGroupRecipientPermissionInTransaction(tx, member.email, "membership_updates", {
      lock, expectedIdentity: { memberId: member.id, personId: identity!.personId },
    });
    recipients.push({ ...member, eligible, reason: eligible ? "" : identity
      ? "Current registration or membership email permission does not qualify"
      : "Member profile has not been released" });
  }
  return recipients;
}
export const practiceAudienceHash = (members: Array<Pick<LifecycleMember, "id" | "email" | "consentId" | "eligible">>) => createHash("sha256")
  .update(JSON.stringify(members.filter(m => m.eligible && m.consentId).map(m => [m.id, m.email, m.consentId]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))).digest("hex");
const iso = (value: Date | string | null) => value ? new Date(value).toISOString() : null;
export function practiceReleaseDeliveryReady() {
  const config = getMemberEmailCadenceDeliveryConfiguration();
  const from = process.env.RESEND_FROM_EMAIL?.trim() ?? "";
  try { assertCadencePayload(renderPracticeRecap("f1", "Member", "member@example.com", from), "member@example.com"); }
  catch { return false; }
  return config.enabled && config.ready && Boolean(config.activatedAt && Date.parse(config.activatedAt) <= Date.now());
}
export async function getPracticeReleaseOverview(actor: string): Promise<PracticeReleaseOverview> {
  return getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, actor);
    const [installed] = await tx`select to_regclass('private.member_practice_release_events') is not null as installed`;
    if (!installed?.installed) return { items: [], decks: [], localEligible: 0, localExcluded: 0, deliveryReady: false, foundationsOpen: isFoundationsLaunched(), setupRequired: true };
    const members = await readPracticeReleaseRecipients(tx);
    const events = await tx<Array<{ course: PracticeReleaseCourse; releaseAt: Date | string | null; releasedAt: Date | string | null; source: string }>>`
      select course,release_at as "releaseAt",released_at as "releasedAt",source from private.member_practice_release_events order by course`;
    const deckRows = await tx<Array<{ course: "f2" | "f3"; releaseAt: Date | string | null; released: boolean }>>`select course,release_at as "releaseAt",release_at is not null and release_at<=clock_timestamp() as released from member_practice_releases where course in ('f2','f3') order by course`;
    const counts = await tx<Array<{ course: string; status: string; count: number }>>`select release.course,delivery.status,count(*)::integer as count
      from private.member_practice_release_deliveries delivery join private.member_practice_release_events release on release.id=delivery.release_id group by release.course,delivery.status`;
    return { items: events.map(event => ({ ...event, title: PRACTICE_RECAPS[event.course].title, releaseAt: iso(event.releaseAt), releasedAt: iso(event.releasedAt),
      counts: Object.fromEntries(counts.filter(row => row.course === event.course).map(row => [row.status, row.count])) })),
      decks: deckRows.map(row => ({ ...row, releaseAt: iso(row.releaseAt) })), localEligible: members.filter(m => m.eligible).length, localExcluded: members.filter(m => !m.eligible).length,
      deliveryReady: practiceReleaseDeliveryReady(), foundationsOpen: isFoundationsLaunched(), setupRequired: false };
  });
}
async function reviewedAudience(actor: string) {
  const local = await getApplicationDatabase().begin(async tx => { await requireAdminEmailActor(tx, actor); return readPracticeReleaseRecipients(tx); });
  const checked = await reviewCadenceProviderRecipients(local.map(member => ({ ...member, memberId: member.id, registeredAt: member.registeredAt ?? member.enrolledAt })));
  return local.map(member => ({ ...member, eligible: checked.find(m => m.memberId === member.id)?.eligible === true }));
}
export async function reviewPracticeRelease(actor: string, rawCourse: unknown): Promise<PracticeReleaseReview> {
  if (!isPracticeReleaseCourse(rawCourse)) throw new AdminEmailError(400, "Foundations 2 and 3 assignments are not ready to release.");
  if (rawCourse === "time" && Date.now() < Date.parse(PRACTICE_TIME_RELEASE_AT)) throw new AdminEmailError(409, "TIME opens automatically on December 1. Its recap will send then.");
  if (!isFoundationsLaunched()) throw new AdminEmailError(409, "Open Foundations member access before releasing an assignment.");
  if (!practiceReleaseDeliveryReady()) throw new AdminEmailError(409, "Automatic member email delivery must be ready before releasing this assignment.");
  const members = await reviewedAudience(actor), hash = practiceAudienceHash(members);
  const review = await getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, actor, true);
    const [event] = await tx`select released_at from private.member_practice_release_events where course=${rawCourse} for share`;
    if (!event) throw new AdminEmailError(404, "This release is unavailable.");
    if (event.released_at) throw new AdminEmailError(409, "This assignment recap has already been released.");
    const [row] = await tx<Array<{ token: string; expiresAt: Date }>>`insert into private.member_practice_release_reviews(actor_auth_user_id,course,audience_hash,copy_version)
      values(${actor}::uuid,${rawCourse},${hash},${PRACTICE_RECAP_VERSION}) returning token,expires_at as "expiresAt"`;
    return row;
  });
  const payload = renderPracticeRecap(rawCourse, "Member", "member@example.com", process.env.RESEND_FROM_EMAIL?.trim() ?? "");
  return { token: review.token, kind: "assignment", title: PRACTICE_RECAPS[rawCourse].title, course: rawCourse, expiresAt: review.expiresAt.toISOString(), eligible: members.filter(m => m.eligible).length,
    excluded: members.filter(m => !m.eligible).length, subject: payload.subject, text: payload.text };
}
export async function queuePracticeRelease(tx: TransactionSql, releaseId: string, members: LifecycleMember[], expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString()) {
  let queued = 0;
  for (const member of members) {
    if (!member.eligible || !member.consentId) continue;
    const inserted = await tx`insert into private.member_practice_release_deliveries(release_id,member_id,expected_email,expected_consent_id,expires_at)
      values(${releaseId}::uuid,${member.id}::uuid,${member.email},${member.consentId}::bigint,${expiresAt}::timestamptz) on conflict(release_id,member_id) do nothing returning id`;
    queued += inserted.length;
  }
  return queued;
}
export async function releasePracticeAssignment(actor: string, token: unknown) {
  if (typeof token !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(token)) throw new AdminEmailError(400, "Review this release first.");
  if (!isFoundationsLaunched() || !practiceReleaseDeliveryReady()) throw new AdminEmailError(409, "Member access and automatic email delivery must be ready.");
  const members = await reviewedAudience(actor), hash = practiceAudienceHash(members);
  await getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, actor, true);
    const [review] = await tx<Array<{ course: PracticeReleaseCourse; audienceHash: string; copyVersion: number; consumed: boolean }>>`
      select course,audience_hash as "audienceHash",copy_version as "copyVersion",consumed_at is not null as consumed
      from private.member_practice_release_reviews where token=${token}::uuid and actor_auth_user_id=${actor}::uuid and kind='assignment' and expires_at>clock_timestamp() for update`;
    if (!review) throw new AdminEmailError(409, "This review expired. Review the current audience again.");
    if (review.course === "time" && Date.now() < Date.parse(PRACTICE_TIME_RELEASE_AT)) throw new AdminEmailError(409, "TIME opens automatically on December 1.");
    const [event] = await tx<Array<{ id: string; releasedAt: Date | null }>>`select id,released_at as "releasedAt" from private.member_practice_release_events where course=${review.course} for update`;
    if (!event) throw new AdminEmailError(404, "This release is unavailable.");
    if (event.releasedAt) return; // Repeated clicks never enqueue a second announcement.
    if (review.consumed || review.audienceHash !== hash || review.copyVersion !== PRACTICE_RECAP_VERSION) throw new AdminEmailError(409, "The audience or recap changed. Review it again before release.");
    // Recheck local membership/permission evidence in the release transaction.
    const current = await readPracticeReleaseRecipients(tx);
    const allowed = new Set(members.filter(m => m.eligible).map(m => `${m.id}:${m.email}:${m.consentId}`));
    const recipients = current.map(m => ({ ...m, eligible: m.eligible && allowed.has(`${m.id}:${m.email}:${m.consentId}`) }));
    if (practiceAudienceHash(recipients) !== hash) throw new AdminEmailError(409, "Member permissions changed. Review the audience again.");
    const releaseAt = new Date().toISOString();
    if (review.course !== "f1") await tx`update member_practice_releases set release_at=${releaseAt}::timestamptz,updated_at=clock_timestamp() where course=${review.course}`;
    await tx`update private.member_practice_release_events set release_at=${releaseAt}::timestamptz,released_at=clock_timestamp(),source='operator',
      approved_by=${actor}::uuid,copy_version=${PRACTICE_RECAP_VERSION},updated_at=clock_timestamp() where id=${event.id}::uuid`;
    const queued = await queuePracticeRelease(tx, event.id, recipients);
    await tx`update private.member_practice_release_reviews set consumed_at=clock_timestamp() where token=${token}::uuid`;
    await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,metadata)
      values(${actor}::uuid,'practice.assignment_released','practice_release',${event.id},${tx.json({ course: review.course, queued, copyVersion: PRACTICE_RECAP_VERSION })})`;
  });
  return getPracticeReleaseOverview(actor);
}
/** Only approved due events are processed; F1/F4 null dates never activate themselves. */
export async function enqueueScheduledPracticeReleases() {
  if (!isFoundationsLaunched()) return 0;
  return getApplicationDatabase().begin(async tx => {
    const [installed] = await tx`select to_regclass('private.member_practice_release_events') is not null as installed`;
    if (!installed?.installed) return 0;
    await tx`update private.member_practice_release_events set source='expired',released_at=clock_timestamp(),updated_at=clock_timestamp()
      where source='scheduled' and released_at is null and release_at<=clock_timestamp()-interval '7 days'`;
    const events = await tx<Array<{ id: string; course: PracticeReleaseCourse; releaseAt: Date | string }>>`select event.id,event.course,event.release_at as "releaseAt" from private.member_practice_release_events event
      join member_practice_releases release on release.course=event.course and release.release_at=event.release_at
      where event.source='scheduled' and event.released_at is null and event.release_at<=clock_timestamp()
        and event.copy_version=${PRACTICE_RECAP_VERSION} for update of event skip locked`;
    if (!events.length) return 0;
    const members = await readPracticeReleaseRecipients(tx); let queued = 0;
    for (const event of events) {
      queued += await queuePracticeRelease(tx, event.id, members, new Date(new Date(event.releaseAt).getTime() + 7 * 86400_000).toISOString());
      await tx`update private.member_practice_release_events set released_at=clock_timestamp(),updated_at=clock_timestamp() where id=${event.id}::uuid`;
    }
    return queued;
  });
}

export async function reviewPracticeDeckRelease(actor: string, course: unknown): Promise<PracticeReleaseReview> {
  if (course !== "f2" && course !== "f3") throw new AdminEmailError(400, "Choose the Foundations 2 or 3 deck.");
  if (!isFoundationsLaunched()) throw new AdminEmailError(409, "Open Foundations member access before releasing a deck.");
  const review = await getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, actor, true);
    const [release] = await tx`select release_at is not null and release_at<=clock_timestamp() as released from member_practice_releases where course=${course} for share`;
    if (!release || release.released) throw new AdminEmailError(409, "That deck is already available, or its release is unavailable.");
    const [row] = await tx<Array<{ token: string; expiresAt: Date }>>`insert into private.member_practice_release_reviews(actor_auth_user_id,course,kind,audience_hash,copy_version)
      values(${actor}::uuid,${course},'deck','deck-only',${PRACTICE_RECAP_VERSION}) returning token,expires_at as "expiresAt"`;
    return row;
  });
  const title = course === "f2" ? "Foundations 2" : "Foundations 3";
  return { token: review.token, kind: "deck", title, course, eligible: 0, excluded: 0, expiresAt: review.expiresAt.toISOString(), subject: title + " · Release the deck",
    text: "Make the complete supporting deck available in The Work after this call.\n\nThe assignment remains to be announced. This action does not send a recap email, award a badge, or create an assignment." };
}
export async function releasePracticeDeck(actor: string, token: unknown) {
  if (typeof token !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(token)) throw new AdminEmailError(400, "Review this deck release first.");
  if (!isFoundationsLaunched()) throw new AdminEmailError(409, "Foundations member access is closed.");
  await getApplicationDatabase().begin(async tx => {
    await requireAdminEmailActor(tx, actor, true);
    const [review] = await tx<Array<{ course: "f2" | "f3"; consumed: boolean }>>`select course,consumed_at is not null as consumed from private.member_practice_release_reviews
      where token=${token}::uuid and actor_auth_user_id=${actor}::uuid and kind='deck' and course in ('f2','f3') and expires_at>clock_timestamp() for update`;
    if (!review) throw new AdminEmailError(409, "This review expired. Review the deck release again.");
    if (review.consumed) return;
    const [release] = await tx`select release_at is not null and release_at<=clock_timestamp() as released from member_practice_releases where course=${review.course} for update`;
    if (!release) throw new AdminEmailError(404, "That course is unavailable.");
    if (!release.released) {
      await tx`update member_practice_releases set release_at=clock_timestamp(),updated_at=clock_timestamp() where course=${review.course}`;
      await tx`insert into operator_audit_events(actor_auth_user_id,action,subject_type,subject_id,metadata)
        values(${actor}::uuid,'practice.deck_released','practice_course',${review.course},${tx.json({ assignment: "tbd", recapQueued: false })})`;
    }
    await tx`update private.member_practice_release_reviews set consumed_at=clock_timestamp() where token=${token}::uuid`;
  });
  return getPracticeReleaseOverview(actor);
}
