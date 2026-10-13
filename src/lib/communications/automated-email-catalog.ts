import "server-only";

import { getRegistrationMessageConfiguration } from "@/lib/membership/registration-message-delivery";
import { getWorkQueueDigestConfiguration } from "@/lib/platform/work-queue-digest-delivery";
import { getRenewalNoticeConfiguration } from "@/lib/stripe/renewal-worker";

export type AutomatedEmailWorkflow = {
  id: "registration" | "renewal" | "work_digest";
  title: string;
  state: "configured" | "paused" | "incomplete";
  statusLabel: string;
  trigger: string;
  timing: string;
  recipients: string;
  management: { href: string; label: string };
  controlBoundary: string;
};

function configurationState(configuration: { enabled: boolean; ready: boolean }): Pick<AutomatedEmailWorkflow, "state" | "statusLabel"> {
  if (!configuration.enabled) return { state: "paused", statusLabel: "Paused" };
  if (!configuration.ready) return { state: "incomplete", statusLabel: "Setup incomplete" };
  return { state: "configured", statusLabel: "Configured" };
}

/** Configuration-only inventory. These getters do not read queues, resolve recipients, or send email. */
export function getAutomatedEmailCatalog(): AutomatedEmailWorkflow[] {
  const registration = getRegistrationMessageConfiguration();
  const renewal = getRenewalNoticeConfiguration();
  const digest = getWorkQueueDigestConfiguration();
  const digestTiming = digest.timeZone === "America/Denver"
    ? "10:00 a.m. and 3:00 p.m. Mountain time, following daylight saving time. Checked every five minutes."
    : digest.timeZone === "Etc/GMT+7"
      ? "10:00 a.m. and 3:00 p.m. Mountain Standard Time (UTC−7), year-round. Checked every five minutes."
      : "10:00 a.m. and 3:00 p.m. in the configured time zone. Time zone setup is incomplete.";

  return [
    {
      id: "registration",
      title: "Welcome and profile-ready emails",
      ...configurationState(registration),
      trigger: "A welcome is queued when registration becomes complete. A profile-ready email is queued when an administrator releases the member’s profile access.",
      timing: "Once per registration milestone, after its requirements are met. Pending messages are checked every five minutes.",
      recipients: "The registered member at their current verified email address. Registration and profile readiness are checked again before delivery.",
      management: { href: "/ops/registrations", label: "Open registrations" },
      controlBoundary: "Registrations shows welcome and profile-ready delivery status and manages profile release. Email copy and the delivery switch are maintained separately from call reminders.",
    },
    {
      id: "renewal",
      title: "Membership renewal notices",
      ...configurationState(renewal),
      trigger: "An eligible annual membership approaches renewal, or a monthly membership approaches the end of its initial term.",
      timing: "Notices are due 40 and 20 days before the renewal or initial term ends. Checked daily at 13:00 UTC.",
      recipients: "The membership customer after current billing and renewal checks. Test mode uses a separate test destination.",
      management: { href: "/ops/access-billing", label: "Review billing services" },
      controlBoundary: "Billing service settings show connection and delivery health. Renewal notice rules, copy, and the delivery switch are maintained in the billing workflow; this page does not change charges or renewal terms.",
    },
    {
      id: "work_digest",
      title: "Operations work summary",
      ...configurationState(digest),
      trigger: "A scheduled summary of the current operations work queue.",
      timing: digestTiming,
      recipients: "One designated operations administrator, with active access and a verified email address.",
      management: { href: "/ops/work", label: "Open work queue" },
      controlBoundary: "The work queue controls the tasks included in the summary. Its recipient, timing, and delivery switch are maintained separately from member email reminders.",
    },
  ];
}
