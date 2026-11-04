import "server-only";
import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { getApplicationDatabase } from "@/lib/database/server";
import { isFoundationsLaunched } from "@/lib/foundations/availability";
import { requireAdminEmailActor } from "@/lib/communications/admin-email-repository";
import { assertCadencePayload, sendCadencePayload } from "@/lib/communications/member-email-cadence-delivery";
import { assertCadenceRecipientDeliverable } from "@/lib/communications/member-email-cadence-provider";
import { CadenceDeliveryError } from "@/lib/communications/member-email-cadence-repository";
import type { CadenceEmailPayload } from "@/lib/communications/member-email-cadence-types";
import { renderPracticeRecap } from "./release-email";
import { enqueueScheduledPracticeReleases, practiceReleaseDeliveryReady, readPracticeReleaseRecipients } from "./release-repository";
import { PRACTICE_RECAP_VERSION, practiceDeliveryMustStop, type PracticeReleaseCourse } from "./release-model";

type Delivery = { id: string; memberId: string; releaseId: string; email: string; consentId: string; attempts: number;
  firstAttemptAt: Date | string | null; payload: CadenceEmailPayload | null; expiresAt: Date | string };
async function withPracticeDelivery(id: string, lease: string, action: (tx: TransactionSql, delivery: Delivery, course: PracticeReleaseCourse, name: string) => Promise<void>) {
  return getApplicationDatabase().begin(async tx => {
    await tx`set local lock_timeout='3s'`;
    await tx`set local statement_timeout='20s'`;
    const [delivery] = await tx<Delivery[]>`select id,member_id as "memberId",release_id as "releaseId",expected_email as email,
      expected_consent_id::text as "consentId",attempts,first_attempt_at as "firstAttemptAt",payload,expires_at as "expiresAt"
      from private.member_practice_release_deliveries where id=${id}::uuid and lock_token=${lease}::uuid and status='sending' for update`;
    if (!delivery) return "deferred" as const;
    const stop = async (reason: string) => {
      const status = delivery.firstAttemptAt ? "manual_review" : "cancelled";
      await tx`update private.member_practice_release_deliveries set status=${status},last_error=${reason},lock_token=null,locked_at=null,updated_at=clock_timestamp() where id=${id}::uuid`;
      return status;
    };
    if (!practiceReleaseDeliveryReady() || !isFoundationsLaunched()) return stop("Member access or email delivery is unavailable");
    const [event] = await tx<Array<{ course: PracticeReleaseCourse; source: string; approvedBy: string | null; copyVersion: number; available: boolean }>>`
      select event.course,event.source,event.approved_by as "approvedBy",event.copy_version as "copyVersion",
        (event.released_at is not null and event.release_at<=clock_timestamp() and
          (event.course='f1' or private.ruined_practice_course_released(event.course))) as available
      from private.member_practice_release_events event where event.id=${delivery.releaseId}::uuid for share`;
    if (!event?.available || event.copyVersion !== PRACTICE_RECAP_VERSION) return stop("Assignment release changed");
    if (event.source === "operator") {
      try { await requireAdminEmailActor(tx, event.approvedBy!, true); } catch { return stop("Release approval is no longer active"); }
    } else if (event.source !== "scheduled" || event.course !== "time") return stop("Release approval is unavailable");
    const [member] = await readPracticeReleaseRecipients(tx, delivery.memberId, true);
    if (!member?.eligible || member.email !== delivery.email || member.consentId !== delivery.consentId) return stop("Member access or email permission changed");
    if (new Date(delivery.expiresAt).getTime() <= Date.now() || practiceDeliveryMustStop(delivery.attempts, delivery.firstAttemptAt)) return stop("Delivery window needs manual review");
    await action(tx, delivery, event.course, member.name);
    return "ok" as const;
  });
}
export async function processPracticeReleaseEmailBatch(limit = 10) {
  const result = { ready: practiceReleaseDeliveryReady(), queued: 0, sent: 0, failed: 0, cancelled: 0, manualReview: 0 };
  if (!result.ready || !isFoundationsLaunched()) return result;
  const sql = getApplicationDatabase(), deadline = Date.now() + 120_000, lease = randomUUID();
  const [installed] = await sql`select to_regclass('private.member_practice_release_events') is not null as installed`;
  if (!installed?.installed) return result;
  result.queued = await enqueueScheduledPracticeReleases();
  await sql`update private.member_practice_release_deliveries set status=case when first_attempt_at is null then 'cancelled' else 'manual_review' end,
    last_error='Delivery window expired',lock_token=null,locked_at=null,updated_at=clock_timestamp()
    where status in ('pending','failed','sending') and expires_at<=clock_timestamp() and (locked_at is null or locked_at<clock_timestamp()-interval '2 minutes')`;
  for (let i = 0; i < Math.min(25, Math.max(1, limit)) && Date.now() < deadline; i++) {
    const [claim] = await sql<Array<{ id: string }>>`with candidate as(select id from private.member_practice_release_deliveries
      where expires_at>clock_timestamp() and ((status in ('pending','failed') and available_at<=clock_timestamp()) or (status='sending' and locked_at<clock_timestamp()-interval '2 minutes'))
      order by available_at,id for update skip locked limit 1)
      update private.member_practice_release_deliveries delivery set status='sending',attempts=attempts+1,lock_token=${lease}::uuid,locked_at=clock_timestamp(),updated_at=clock_timestamp()
      from candidate where delivery.id=candidate.id returning delivery.id`;
    if (!claim) break;
    try {
      const prepared = await withPracticeDelivery(claim.id, lease, async (tx, delivery, course, name) => {
        const payload = delivery.payload ?? renderPracticeRecap(course, name, delivery.email, process.env.RESEND_FROM_EMAIL?.trim() ?? "");
        assertCadencePayload(payload, delivery.email);
        // A provider suppression discovered before any attempt cancels safely.
        if (!delivery.firstAttemptAt) await assertCadenceRecipientDeliverable(delivery.email, { deadline });
        await tx`update private.member_practice_release_deliveries set payload=coalesce(payload,${tx.json(payload)}),
          first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),updated_at=clock_timestamp() where id=${delivery.id}::uuid`;
      });
      if (prepared !== "ok") { if (prepared === "manual_review") result.manualReview++; else if (prepared === "cancelled") result.cancelled++; continue; }
      const outcome = await withPracticeDelivery(claim.id, lease, async (tx, delivery) => {
        if (!delivery.payload || !delivery.firstAttemptAt) throw new Error("Frozen recap unavailable");
        assertCadencePayload(delivery.payload, delivery.email);
        const sendDeadline = Math.min(deadline, new Date(delivery.expiresAt).getTime());
        await assertCadenceRecipientDeliverable(delivery.email, { deadline: sendDeadline });
        const providerId = await sendCadencePayload(delivery.payload, delivery.id, sendDeadline);
        await tx`update private.member_practice_release_deliveries set status='sent',sent_at=clock_timestamp(),provider_message_id=${providerId},
          lock_token=null,locked_at=null,last_error=null,updated_at=clock_timestamp() where id=${delivery.id}::uuid`;
      });
      if (outcome === "ok") result.sent++; else if (outcome === "manual_review") result.manualReview++; else if (outcome === "cancelled") result.cancelled++;
    } catch (error) {
      const terminal = error instanceof CadenceDeliveryError && error.terminal;
      const [updated] = await sql<Array<{ status: string }>>`update private.member_practice_release_deliveries set
        status=case when ${terminal} then case when first_attempt_at is null then 'cancelled' else 'manual_review' end else 'failed' end,
        last_error=${terminal ? "Delivery stopped; review current permission and provider status" : "Delivery unavailable; retry pending"},
        lock_token=null,locked_at=null,available_at=clock_timestamp()+interval '10 minutes',updated_at=clock_timestamp()
        where id=${claim.id}::uuid and lock_token=${lease}::uuid and status='sending' returning status`;
      if (updated?.status === "manual_review") result.manualReview++; else if (updated?.status === "cancelled") result.cancelled++; else result.failed++;
      if (error instanceof CadenceDeliveryError && ["provider_timeout", "delivery_budget"].includes(error.code)) break;
    }
  }
  return result;
}
