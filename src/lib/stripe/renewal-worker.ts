import "server-only";

import { randomUUID } from "node:crypto";
import { Resend } from "resend";

import { getPlatformConfiguration } from "@/lib/platform/config";
import { SUPPORT_EMAIL } from "@/lib/support/model";
import { matchesMembershipPortalPolicy } from "@/lib/stripe/portal-policy";
import { getMembershipPriceConfiguration, getStripe } from "@/lib/stripe/server";
import { createMembershipRenewalEmail } from "./renewal-email";
import { RenewalNoticeError, renewalInvoicePreview, validateRenewalSubscription } from "./renewal-policy";
import {
  claimRenewalNotice, getRenewalNoticeHealth, enqueueMembershipRenewalNotices,
  fenceRenewalNoticeSend, finishRenewalNotice, persistRenewalNoticePayload,
  type RenewalEmailPayload,
} from "./renewal-repository";

const MAX_ATTEMPTS = 5;
const REPLAY_WINDOW_MS = 23 * 60 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 6_000;
const BATCH_BUDGET_MS = 20_000;
const STRIPE_REQUEST_OPTIONS = { timeout: 6_000, maxNetworkRetries: 0 };
const value = (name: string) => process.env[name]?.trim() ?? "";
const validEmail = (email: string) => email.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email);

function siteUrl(): URL | null {
  try {
    const site = new URL(value("NEXT_PUBLIC_SITE_URL"));
    if (site.username || site.password || site.search || site.hash || site.pathname !== "/") return null;
    if (site.protocol !== "https:") return null;
    return site;
  } catch { return null; }
}

export function getRenewalNoticeConfiguration() {
  const enabled = value("STRIPE_MEMBERSHIP_RENEWAL_EMAILS_ENABLED") === "true";
  const keyMode = value("STRIPE_SECRET_KEY").match(/^(?:sk|rk)_(live|test)_/)?.[1];
  const from = value("RESEND_FROM_EMAIL");
  const fromEmail = (from.match(/^[^<>\r\n]+<([^<>]+)>$/)?.[1] ?? from).trim();
  const testRecipient = value("STRIPE_MEMBERSHIP_RENEWAL_TEST_RECIPIENT");
  const missing = [
    ...(!enabled ? ["STRIPE_MEMBERSHIP_RENEWAL_EMAILS_ENABLED=true"] : []),
    ...(getPlatformConfiguration().mode !== "connected" ? ["connected platform"] : []),
    ...(!keyMode ? ["STRIPE_SECRET_KEY"] : []),
    ...(!value("STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID") ? ["STRIPE_MEMBERSHIP_ANNUAL_PRICE_ID"] : []),
    ...(!value("STRIPE_BILLING_PORTAL_CONFIGURATION_ID") && !value("STRIPE_MEMBERSHIP_COMMITMENT_PORTAL_CONFIGURATION_ID") ? ["membership billing portal configuration"] : []),
    ...(!value("RESEND_API_KEY") ? ["RESEND_API_KEY"] : []),
    ...(!validEmail(fromEmail) || /[\r\n]/.test(from) ? ["RESEND_FROM_EMAIL"] : []),
    ...(!siteUrl() ? ["NEXT_PUBLIC_SITE_URL"] : []),
    ...(keyMode === "test" && !validEmail(testRecipient) ? ["STRIPE_MEMBERSHIP_RENEWAL_TEST_RECIPIENT"] : []),
  ];
  return { enabled, ready: missing.length === 0, missing, scope: "annual_renewals_and_initial_monthly_term_end" as const };
}

class ProviderFailure extends RenewalNoticeError {
  constructor(code: string, disposition: "retry" | "manual_review", readonly definitelyRejected = false) { super(code, disposition); }
}

async function sendWithTimeout(client: Resend, payload: RenewalEmailPayload, id: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      client.emails.send(payload, { idempotencyKey: `ruined-membership-renewal/${id}` }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ProviderFailure("provider_timeout", "retry")), PROVIDER_TIMEOUT_MS); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Default-off billing worker. Monthly anniversary dates come only from the
 * immutable accepted commitment; a monthly billing period is not an anniversary.
 * Never sends to real member addresses in test mode. */
export async function processMembershipRenewalNotices(requestedLimit = 25) {
  const result = { ...getRenewalNoticeConfiguration(), queued: 0, claimed: 0, sent: 0, failed: 0, cancelled: 0, deferred: 0, manualReview: 0, remainingDue: 0 };
  if (!result.ready) return result;
  const configuration = getMembershipPriceConfiguration();
  const stripe = getStripe();
  const client = new Resend(value("RESEND_API_KEY"));
  const lease = randomUUID();
  const site = siteUrl()!;
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(25, Math.trunc(requestedLimit))) : 10;
  const start = Date.now();
  try {
    result.queued = await enqueueMembershipRenewalNotices(configuration, configuration.livemode, new Date());
    for (let index = 0; index < limit && Date.now() - start < BATCH_BUDGET_MS; index++) {
      const notice = await claimRenewalNotice(configuration.livemode, lease, new Date());
      if (!notice) break;
      result.claimed++;
      let providerCalled = false;
      try {
        const first = notice.firstSendAttemptAt === null ? null : new Date(notice.firstSendAttemptAt).getTime();
        if (first !== null && (!Number.isFinite(first) || Date.now() - first >= REPLAY_WINDOW_MS)) {
          throw new RenewalNoticeError("uncertain_delivery_requires_manual_review");
        }
        if (notice.attempts > MAX_ATTEMPTS) throw new RenewalNoticeError("attempts_exhausted");
        if (!validEmail(notice.email)) throw new RenewalNoticeError("member_email_unavailable");
        const portalKind = notice.commitmentId ? "commitment" : "legacy";
        const portalId = value(portalKind === "commitment" ? "STRIPE_MEMBERSHIP_COMMITMENT_PORTAL_CONFIGURATION_ID" : "STRIPE_BILLING_PORTAL_CONFIGURATION_ID");
        if (!portalId) throw new RenewalNoticeError("billing_portal_unavailable", "retry");
        const portal = await stripe.billingPortal.configurations.retrieve(portalId, {}, STRIPE_REQUEST_OPTIONS);
        if (!matchesMembershipPortalPolicy(portal, portalId, configuration.livemode, portalKind)) throw new RenewalNoticeError("billing_portal_unavailable", "retry");
        const subscription = await stripe.subscriptions.retrieve(notice.subscriptionId, {}, STRIPE_REQUEST_OPTIONS);
        validateRenewalSubscription(subscription, notice, configuration, new Date());
        const invoice = await stripe.invoices.createPreview({ customer: notice.customerId, subscription: notice.subscriptionId, preview_mode: "next" }, STRIPE_REQUEST_OPTIONS);
        const preview = renewalInvoicePreview(invoice, subscription, configuration, notice);
        let payload = notice.payload;
        if (payload) {
          if (notice.savedMemberEmail !== notice.email || !notice.preview
            || (Object.keys(preview) as Array<keyof typeof preview>).some(key => preview[key] !== notice.preview![key])) {
            throw new RenewalNoticeError("saved_notice_changed_requires_review");
          }
        } else {
          payload = { from: value("RESEND_FROM_EMAIL"), to: configuration.livemode ? notice.email : value("STRIPE_MEMBERSHIP_RENEWAL_TEST_RECIPIENT"),
            replyTo: SUPPORT_EMAIL, ...createMembershipRenewalEmail(preview, site) };
          if (!configuration.livemode) payload.subject = `[TEST] ${payload.subject}`;
          if (!await persistRenewalNoticePayload(notice.id, lease, payload, preview, notice.email)) { result.deferred++; continue; }
        }
        // Cancellation or a changed period after claiming/preparing the message
        // must prevent delivery. This second read is immediately before fencing.
        validateRenewalSubscription(await stripe.subscriptions.retrieve(notice.subscriptionId, {}, STRIPE_REQUEST_OPTIONS), notice, configuration, new Date());
        if (!await fenceRenewalNoticeSend(notice.id, lease)) throw new RenewalNoticeError("member_or_subscription_changed");
        providerCalled = true;
        const response = await sendWithTimeout(client, payload, notice.id);
        if (response.error || !response.data?.id) {
          const status = response.error?.statusCode;
          const retryable = !status || status === 408 || status === 429 || status >= 500 || response.error?.name === "concurrent_idempotent_requests";
          const rejected = typeof status === "number" && status >= 400 && status < 500 && status !== 408 && status !== 409;
          throw new ProviderFailure(status ? `provider_http_${status}` : "provider_unavailable", retryable ? "retry" : "manual_review", rejected);
        }
        if (await finishRenewalNotice(notice.id, lease, "sent", null, response.data.id)) result.sent++;
        else result.deferred++;
      } catch (error) {
        const code = error instanceof RenewalNoticeError ? error.code : providerCalled ? "uncertain_provider_failure" : "preflight_unavailable";
        const disposition = error instanceof RenewalNoticeError ? error.disposition : "retry";
        const outcome = disposition === "cancelled" ? "cancelled" : disposition === "manual_review" || notice.attempts >= MAX_ATTEMPTS ? "manual_review" : "failed";
        // Only a proven rejection of the FIRST send clears uncertainty. An
        // earlier timeout stays fenced even if a later attempt is rejected.
        const clearFence = notice.firstSendAttemptAt === null && error instanceof ProviderFailure && error.definitelyRejected;
        const delay = Math.min(3600, 60 * 2 ** Math.min(notice.attempts - 1, MAX_ATTEMPTS));
        const recorded = await finishRenewalNotice(notice.id, lease, outcome, code, null, delay, clearFence);
        if (!recorded) result.deferred++;
        else if (outcome === "failed") result.failed++;
        else if (outcome === "cancelled") result.cancelled++;
        if (code === "provider_timeout") break;
      }
    }
    Object.assign(result, await getRenewalNoticeHealth(configuration.livemode));
  } catch {
    result.ready = false;
    result.missing = ["renewal worker or billing configuration unavailable"];
  }
  return result;
}
