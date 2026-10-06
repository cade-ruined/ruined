import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Resend } from "resend";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { SUPPORT_EMAIL } from "@/lib/support/model";
import { createRegistrationEmail } from "./registration-email";
import { renderRegistrationInvitationHero } from "./registration-invitation-image";
import {
  claimRegistrationMessage, completeRegistrationMessage, failRegistrationMessage,
  preserveRegistrationMessage, RegistrationDeliveryError, withRegistrationMessage,
  type RegistrationEmailPayload, type RegistrationMessageClaim,
} from "./registration-message-repository";

const PROVIDER_TIMEOUT_MS = 6_000;
const BATCH_BUDGET_MS = 15_000;
const REPLAY_WINDOW_MS = 23 * 60 * 60 * 1000;
const value = (name: string) => process.env[name]?.trim() ?? "";
const validEmail = (email: string) => email.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email);

function configuredSite(): URL | null {
  try {
    const site = new URL(value("NEXT_PUBLIC_SITE_URL"));
    if (site.username || site.password || site.search || site.hash || site.pathname !== "/" || site.protocol !== "https:") return null;
    if (["localhost","127.0.0.1","[::1]"].includes(site.hostname)) return null;
    return site;
  } catch { return null; }
}

/** Independent from newsletters/marketing and off until the release is enabled. */
export function getRegistrationMessageConfiguration() {
  const enabled = value("MEMBER_REGISTRATION_EMAILS_ENABLED") === "true";
  const from = value("RESEND_FROM_EMAIL");
  const fromEmail = (from.match(/^[^<>\r\n]+<([^<>]+)>$/)?.[1] ?? from).trim();
  const missing = [
    ...(!enabled ? ["MEMBER_REGISTRATION_EMAILS_ENABLED=true"] : []),
    ...(getPlatformConfiguration().mode !== "connected" ? ["connected platform"] : []),
    ...(!value("RESEND_API_KEY") ? ["RESEND_API_KEY"] : []),
    ...(!validEmail(fromEmail) || /[\r\n]/.test(from) ? ["RESEND_FROM_EMAIL"] : []),
    ...(!configuredSite() ? ["NEXT_PUBLIC_SITE_URL"] : []),
  ];
  return { enabled, ready: missing.length === 0, missing };
}

function assertReplayWindow(message: RegistrationMessageClaim) {
  if (message.attempts > 5) throw new RegistrationDeliveryError("attempts_exhausted",true);
  if (message.first_send_attempt_at !== null) {
    const started = new Date(message.first_send_attempt_at).getTime();
    if (!Number.isFinite(started) || Date.now()-started >= REPLAY_WINDOW_MS) {
      throw new RegistrationDeliveryError("uncertain_delivery_requires_manual_review",true);
    }
  }
}

async function sendWithTimeout(client: Resend, payload: RegistrationEmailPayload, id: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      client.emails.send(payload,{ idempotencyKey: `registration:${id}` }),
      new Promise<never>((_,reject) => {
        timer=setTimeout(() => reject(new RegistrationDeliveryError("provider_timeout")),PROVIDER_TIMEOUT_MS);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Delivers only atomically queued registration receipts/profile release notices.
 * This function never registers members, activates profiles, or charges cards. */
export async function processRegistrationMessageBatch(requestedLimit=10,options: { memberId?: string }={}) {
  const result = { ...getRegistrationMessageConfiguration(),claimed:0,sent:0,failed:0,cancelled:0,deferred:0,manualReview:0 };
  if (!result.ready) return result;
  const client = new Resend(value("RESEND_API_KEY"));
  const site = configuredSite()!;
  const lease = randomUUID();
  const limit = Number.isFinite(requestedLimit) ? Math.max(1,Math.min(25,Math.trunc(requestedLimit))) : 10;
  const started=Date.now();
  try {
    for (let index=0;index<limit && Date.now()-started<BATCH_BUDGET_MS;index++) {
      const claim=await claimRegistrationMessage(lease,options.memberId);
      if (!claim) break;
      result.claimed++;
      try {
        const prepared=await withRegistrationMessage(claim,lease,async (tx,message) => {
          assertReplayWindow(message);
          if (!validEmail(message.email)) throw new RegistrationDeliveryError("recipient_unavailable",true);
          let payload=message.delivery_payload;
          if (!payload) {
            const invitation=message.kind==="welcome" ? message.accepted_invitation : null;
            const attachments: RegistrationEmailPayload["attachments"] = invitation ? [{
              filename:"your-invitation.jpg",contentId:"ruined-invitation",
              content:(await renderRegistrationInvitationHero({
                recipientName:invitation.recipient_name,
                inviterName:invitation.origin==="ruined_direct" ? "The Ruined Project" : invitation.inviter_name,
                inviterTag:invitation.inviter_tag,invitationSource:invitation.origin,
                issuedAt:new Date(invitation.issued_at).toISOString(),expiresAt:invitation.expires_at === null ? null : new Date(invitation.expires_at).toISOString(),
                wearSeed:createHash("sha256").update(`ruined-invitation:${invitation.owner_member_id ?? "ruined-direct"}`).digest("hex").slice(0,24),
              })).toString("base64"),
            }] : undefined;
            payload={
              from:value("RESEND_FROM_EMAIL"),to:message.email,replyTo:SUPPORT_EMAIL,
              ...createRegistrationEmail({kind:message.kind,memberName:message.member_name,
                completionBasis:message.completion_basis,siteUrl:site,
                foundingPricing:message.founding_pricing,
                paidMembership:message.paid_membership,
                ...(attachments ? {invitationImageSrc:"cid:ruined-invitation"} : {})}),
              ...(attachments ? {attachments} : {}),
            };
          }
          if (payload.to!==message.email) throw new RegistrationDeliveryError("recipient_changed_requires_review",true);
          // Both immutable bytes and the uncertainty fence commit BEFORE the
          // provider call. A crash cannot create a new send after key expiry.
          await preserveRegistrationMessage(tx,message.id,payload,
            message.kind==="welcome" && message.completion_basis==="paid_membership" ? message.paid_reservation_id : null);
        });
        if (prepared.kind!=="ok") { result[prepared.kind]++;continue; }
        const sent=await withRegistrationMessage(claim,lease,async (tx,message) => {
          assertReplayWindow(message);
          if (!message.first_send_attempt_at || !message.delivery_payload || message.delivery_payload.to!==message.email) {
            throw new RegistrationDeliveryError("saved_message_changed_requires_review",true);
          }
          const response=await sendWithTimeout(client,message.delivery_payload,message.id);
          if (response.error || !response.data?.id) {
            const status=response.error?.statusCode;
            const retryable=!status || status===408 || status===429 || status>=500
              || response.error?.name==="concurrent_idempotent_requests";
            throw new RegistrationDeliveryError(status ? `provider_http_${status}` : "provider_unavailable",!retryable);
          }
          await completeRegistrationMessage(tx,message.id,response.data.id);
        });
        if (sent.kind==="ok") result.sent++;
        else result[sent.kind]++;
      } catch (error) {
        const code=error instanceof RegistrationDeliveryError ? error.code : "delivery_unavailable";
        const terminal=error instanceof RegistrationDeliveryError && error.terminal;
        const outcome=await failRegistrationMessage(claim,lease,code,terminal);
        result[outcome]++;
        // The timed-out request can still finish. Retry later with identical
        // bytes/key; never send another message in this batch after uncertainty.
        if (code==="provider_timeout") break;
      }
    }
  } catch {
    result.ready=false;
    result.missing=["registration message worker unavailable"];
  }
  return result;
}
