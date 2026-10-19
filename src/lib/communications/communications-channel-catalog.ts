import "server-only";

import { getPersonalInvitationEmailReady } from "@/lib/membership/personal-invitation-delivery";
import { getPlatformConfiguration } from "@/lib/platform/config";
import { getSupabaseConfigStatus } from "@/lib/supabase/config";
import { readMemberSmsAutomationConfiguration } from "./member-sms-automation-model";
import { getMemberSmsConfigurationStatus } from "./member-sms-config";
import type { CommunicationItem } from "./communications-catalog";

type State = Pick<CommunicationItem, "status" | "statusLabel">;

function configured(ready: boolean, label = "Configured"): State {
  return ready ? { status: "enabled", statusLabel: label } : { status: "attention", statusLabel: "Setup incomplete" };
}

/**
 * Configuration-only inventory of existing channels. No queue, consent, recipient,
 * database, authentication session, or provider request is read or changed here.
 * Configured describes prerequisites; it is not evidence that a message was sent.
 */
export function getCommunicationsChannelCatalog(): CommunicationItem[] {
  const platform = getPlatformConfiguration();
  const auth = getSupabaseConfigStatus();
  const connected = platform.mode === "connected" && auth.configured;
  const workerConfigured = Boolean(process.env.CRON_SECRET?.trim());
  const transport = getMemberSmsConfigurationStatus();
  const automation = readMemberSmsAutomationConfiguration();
  const activationTime = automation.activatedAt ? Date.parse(automation.activatedAt) : NaN;
  const smsState: State = !transport.enabled || !automation.enabled
    ? { status: "paused", statusLabel: "Paused" }
    : !connected || !workerConfigured || !transport.sendReady || !automation.ready || !Number.isFinite(activationTime)
      ? { status: "attention", statusLabel: "Setup incomplete" }
      : activationTime > Date.now()
        ? { status: "paused", statusLabel: "Activation scheduled" }
        : { status: "enabled", statusLabel: "Configured" };
  return channelCatalog({ connected, workerConfigured, invitationEmailReady: getPersonalInvitationEmailReady() && connected, smsState });
}

/** Uses the same inventory without reading deployment configuration. */
export function getCommunicationsChannelPreviewCatalog(): CommunicationItem[] {
  return channelCatalog({ connected: false, workerConfigured: false, invitationEmailReady: false,
    smsState: { status: "paused", statusLabel: "Paused" } }).map(item => ({
    ...item,
    status: item.status === "manual" ? "manual" : "paused",
    statusLabel: item.status === "manual" ? "Sample · manual" : "Sample · not enabled",
    detail: `Sample workspace. Nothing is saved or sent. ${item.detail ?? ""}`,
  }));
}

function channelCatalog({ connected, workerConfigured, invitationEmailReady, smsState }: {
  connected: boolean; workerConfigured: boolean; invitationEmailReady: boolean; smsState: State;
}): CommunicationItem[] {
  const workflowState: State = !connected ? configured(false)
    : !workerConfigured ? { status: "attention", statusLabel: "Worker recovery not configured" }
      : configured(true);
  const workflowDetail = "An existing in-app workflow. Relevant actions can process it immediately; scheduled recovery runs daily at 12:30 UTC. Configuration does not verify database migrations, worker activity, or delivery. Copy is maintained in the workflow.";
  const smsDetail = "Requires both outbound SMS switches, transport setup, an elapsed activation time, and the scheduled worker. Current explicit SMS consent, matching phone, account eligibility, and opt-out suppression are checked before sending. Configuration does not prove carrier approval or delivery. Delivery switches and copy have no editor here.";
  const smsCallReminder = {
    channel: "texts" as const,
    ...smsState,
    audience: "Active members with released profile access, current SMS consent, and access to that call.",
    timing: "60 minutes before the call, checked every five minutes. The send window expires after 10 minutes.",
    detail: `One shared SMS rule covers Foundations, Membership, and Circle calls. These catalog entries share the same schedule and configuration. ${smsDetail} A successful opt-in confirmation is required before the call reminder. Call changes and access are checked again before delivery.`,
    action: { label: "Review calls", href: "/ops/experiences" },
  };

  return [
    {
      id: "manual:invitation-text", channel: "texts", bucket: "registration", title: "Personal invitation text",
      status: "manual", statusLabel: "Manual",
      trigger: "A member chooses Text invitation for a saved personal invitation.",
      audience: "The invitation’s intended recipient, using the saved phone number.",
      timing: "When the sender reviews and sends the prepared text in their own messaging app.",
      detail: "Opens a prefilled SMS draft. Ruined does not send it through Twilio or confirm that it was sent. Invitation tools require eligible member access.",
      action: { label: "Open invitation tools", href: "/my/invitation" },
    },
    {
      id: "sms:opt-in-confirmation", channel: "texts", bucket: "registration", title: "Text opt-in confirmation",
      ...smsState,
      trigger: "A member explicitly opts in to membership texts after automation activation.",
      audience: "Members with current, supported SMS consent for their present phone number.",
      timing: "Within 10 minutes of a new opt-in, checked every five minutes. Older consent is confirmed only when an eligible call reminder becomes due.",
      detail: smsDetail,
      action: { label: "View text opt-in", href: "/membership/text-messages" },
    },
    {
      ...smsCallReminder,
      id: "sms:foundations-call-reminder", bucket: "foundations", title: "60-minute Foundations reminder",
      trigger: "An eligible published Foundations call with a working Google Meet link is one hour away.",
    },
    {
      ...smsCallReminder,
      id: "sms:membership-call-reminder", bucket: "membership", title: "60-minute Membership / Circle reminder",
      trigger: "An eligible published Membership or Circle call with a working Google Meet link is one hour away.",
    },
    {
      id: "email:personal-invitation", channel: "emails", bucket: "registration", title: "Personal invitation email",
      ...configured(invitationEmailReady, "Transactional · configured"),
      trigger: "A member requests email delivery for an invitation, or an eligible Ruined Direct signup queues its invitation.",
      audience: "The specific invitation recipient. This does not create a marketing subscription.",
      timing: "Queued after the request; immediate processing is attempted, with background recovery for pending delivery.",
      detail: "The invitation workflow checks that the invitation and inviter remain eligible before sending. Ruined Direct signup has its own launch gates. This status checks configuration only; it does not inspect invitations or confirm inbox delivery.",
      action: { label: "Review direct invitations", href: "/ops/members#direct-invitations" },
    },
    {
      id: "email:access-verification", channel: "emails", bucket: "registration", title: "Email verification and access code",
      ...configured(connected, "Transactional · configured"),
      trigger: "An eligible invited or returning account requests an email code.",
      audience: "The email address whose invitation or account eligibility passes the access check.",
      timing: "On request through the access or invitation flow.",
      detail: "Supabase Auth supplies the verification code or confirmation link. This checks local authentication configuration only; provider email settings and delivery are unverified. Message templates are managed by the authentication service.",
      action: { label: "Review account access", href: "/ops/access-billing" },
    },
    {
      id: "manual:operator-alert", channel: "notifications", bucket: "misc", title: "Operator alert",
      status: "manual", statusLabel: "Manual",
      trigger: "An operations administrator reviews and sends a notification.",
      audience: "The selected active members, member, Circle, or Block, subject to current access checks.",
      timing: "Saved in the member app when the operator confirms Send notification.",
      detail: "An in-app message only. No email, text message, or device push is sent. Title, message, audience, and action link are editable in Alerts.",
      action: { label: "Open alerts", href: "/ops/messages?mode=alerts" },
    },
    {
      id: "manual:board-post", channel: "notifications", bucket: "misc", title: "Board post and announcement alert",
      status: "manual", statusLabel: "Manual",
      trigger: "An operator reviews and publishes a saved Board post.",
      audience: "Members matching the post’s selected audience and current membership access.",
      timing: "The Board post becomes visible on publication; its in-app alert is queued for workflow processing.",
      detail: "Drafts remain private. Publishing creates a lasting announcement and queues an in-app notification; it does not send email or SMS. The workflow worker handles alerts, and retracting the post cancels its notifications.",
      action: { label: "Open Board posts", href: "/ops/messages?mode=posts" },
    },
    {
      id: "notification:onboarding-complete", channel: "notifications", bucket: "pre-foundations", title: "Welcome to My Ruined",
      ...workflowState,
      trigger: "Administrative membership onboarding is marked complete.",
      audience: "The member whose onboarding was completed.",
      timing: "Queued at completion, then saved in the app by the workflow worker.",
      detail: `${workflowDetail} Opens Ruined Foundations; this is separate from the registration welcome email.`,
      action: { label: "Review workflow activity", href: "/ops/system#failed-actions" },
    },
    {
      id: "notification:foundations-complete", channel: "notifications", bucket: "foundations", title: "Foundations complete",
      ...workflowState,
      trigger: "A member’s Foundations enrollment reaches completion.",
      audience: "The member who completed Foundations.",
      timing: "Queued at completion, then saved in the app by the workflow worker.",
      detail: `${workflowDetail} The notification points to My Ruined for the member’s Circle and next steps.`,
      action: { label: "Review Foundations", href: "/ops/foundations" },
    },
    {
      id: "notification:circle-reveal", channel: "notifications", bucket: "membership", title: "Your Circle is ready",
      ...workflowState,
      trigger: "A Circle assignment is made after the member has completed Foundations.",
      audience: "The assigned member. Assignments before Foundations completion remain private.",
      timing: "Queued for an eligible assignment or transfer. Earlier assignments are introduced through the Foundations completion workflow.",
      detail: `${workflowDetail} This existing notification does not imply a separate Circle reveal email.`,
      action: { label: "Review Circles", href: "/ops/circles" },
    },
    {
      id: "notification:support-reply", channel: "notifications", bucket: "misc", title: "Support reply alert",
      ...configured(connected),
      trigger: "An operator replies to a member’s support request.",
      audience: "The requester, when their account is linked to a member profile.",
      timing: "Saved in the app with the operator’s reply.",
      detail: "The alert links to the support request without copying the private reply into the notification feed. Support email delivery is a separate channel. This status checks platform configuration only.",
      action: { label: "Open support", href: "/ops/support" },
    },
  ];
}
