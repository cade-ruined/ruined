import "server-only";

import { listMembershipPrepaymentsDue } from "@/lib/stripe/billing-repository";
import { getStripeLivemode } from "@/lib/stripe/server";
import { reconcilePrepaidMembershipSubscription } from "@/lib/stripe/webhook";
import {
  listPendingPrepaidMembershipCancellations,
  reconcilePrepaidMembershipCancellation,
  refundMissedFoundationsEnrollment,
} from "@/lib/stripe/cancellation-service";

const BATCH_BUDGET_MS = 20_000;

/** Fulfill already-accepted obligations independently of new-purchase flags.
 * This worker never sends communications or grants manual profile access. */
export async function processMembershipPrepayments(requestedLimit = 5) {
  const result = { ready: false, examined: 0, reconciled: 0, refundsResumed: 0, pending: 0, manualReview: 0, failed: 0, remainingDue: 0 };
  if (!process.env.DATABASE_URL?.trim() || !/^(?:sk|rk)_(?:live|test)_/.test(process.env.STRIPE_SECRET_KEY?.trim() ?? "")) return result;
  result.ready = true;
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(10, Math.floor(requestedLimit))) : 5;
  const startedAt = Date.now(), seen = new Set<string>(), livemode = getStripeLivemode();
  try {
    const pending = (await listPendingPrepaidMembershipCancellations(100)).filter(row => row.livemode === livemode);
    const due = await listMembershipPrepaymentsDue({ limit, livemode });
    // Reserve batch capacity for due service starts even when several provider
    // refunds stay pending across repeated runs.
    const pendingBudget = due.length ? Math.max(1, Math.floor(limit / 2)) : limit;
    for (const row of pending) {
      if (result.examined >= pendingBudget || Date.now() - startedAt >= BATCH_BUDGET_MS) break;
      seen.add(row.subscriptionId);result.examined++;
      try {
        const resumed = await reconcilePrepaidMembershipCancellation(row);
        if (resumed.handled) {
          result.refundsResumed++;
          if ("pending" in resumed && resumed.pending) result.pending++;
          if ("reviewRequired" in resumed && resumed.reviewRequired) result.manualReview++;
        }
        // A completed refund may need its canceled subscription projection even
        // when the provider webhook arrived while the cancellation lease was held.
        await reconcilePrepaidMembershipSubscription(row.subscriptionId);
        result.reconciled++;
      } catch (error) {
        result.failed++;
        console.error("Prepaid cancellation reconciliation failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
      }
    }
    for (const proof of due) {
      if (seen.has(proof.subscriptionId)) continue;
      if (result.examined >= limit || Date.now() - startedAt >= BATCH_BUDGET_MS) break;
      seen.add(proof.subscriptionId);result.examined++;
      try {
        if (proof.refundState === "review_required" && proof.reviewReason === "cohort_cutoff_missed") {
          // The internal executor verifies an invalid enrollment and resumes one
          // durable cancellation; it never treats this as a member's new request.
          await refundMissedFoundationsEnrollment({ subscriptionId: proof.subscriptionId, livemode });
          result.refundsResumed++;
        }
        await reconcilePrepaidMembershipSubscription(proof.subscriptionId);
        result.reconciled++;
      } catch (error) {
        result.failed++;
        console.error("Prepaid membership reconciliation failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
      }
    }
    const remaining = await listMembershipPrepaymentsDue({ limit: 100, livemode });
    result.remainingDue = remaining.length;
  } catch (error) {
    result.failed++;
    console.error("Prepaid membership batch could not finish", { errorType: error instanceof Error ? error.name : "UnknownError" });
  }
  return result;
}
