import { LIFECYCLE_EMAIL_KEYS, LIFECYCLE_TITLES, type LifecycleEmailKey } from "./member-lifecycle-email-model";
import type { CommunicationItem } from "./communications-catalog";
export type LifecycleEmailItem = {
  revision: number; key: LifecycleEmailKey; title: string; enabled: boolean; ready: boolean; missing: string[];
  settings: Record<string, string>; nextDueAt: string | null; eligible: number; lastSentAt: string | null;
  subject?: string; body?: string; tokens?: string[];
  preview?: { subject: string; html: string; text: string } | null;
};
export type LifecycleEmailOverview = { deliveryEnabled?: boolean; setupRequired?: boolean; closures?: Array<{title:string;start:string;end:string}>; items: LifecycleEmailItem[]; recent: Array<{ id: string; key: string; status: string; dueAt: string; sentAt: string | null; error: string | null }> };
export const LIFECYCLE_DESCRIPTIONS: Record<LifecycleEmailKey, { trigger: string; timing: string; audience: string }> = {
  birthday: { trigger: "The member’s birthday, once the designated gift and redeemable code are ready.", timing: "Birthday · 10 a.m. MT", audience: "Eligible active members with a verified birthday and email permission." },
  anniversary: { trigger: "The first anniversary of completed registration.", timing: "One year after registration · 3 p.m. MT · once", audience: "Eligible graduated members with a current Circle and attended Membership call, at their first registration anniversary. Later years are held." },
  ruined_birthday: { trigger: "RU/NED’s birthday on July 30.", timing: "July 30 · 3 p.m. MT", audience: "Current eligible members with email permission." },
  thanksgiving: { trigger: "The approved Thanksgiving schedule for this year.", timing: "Seven days before Thanksgiving · 3 p.m. MT", audience: "Current eligible members affected by the holiday schedule." },
  christmas: { trigger: "The approved Christmas / end-of-year schedule for this year.", timing: "December 17 · 3 p.m. MT", audience: "Current eligible members affected by the holiday schedule." },
  new_year: { trigger: "The start of the new year.", timing: "January 1 · 3 p.m. MT", audience: "Current eligible members with email permission." },
  checkin_30: { trigger: "30 days after the first attended Membership call.", timing: "30 days after that call · 3 p.m. MT · once", audience: "Eligible members with recorded attendance at their first Membership call." },
  checkin_90: { trigger: "90 days after the first attended Membership call.", timing: "90 days after that call · 3 p.m. MT · once", audience: "Eligible members with recorded attendance at their first Membership call." },
  checkin_6_month: { trigger: "Six calendar months after the first attended Membership call.", timing: "Six months after that call · 3 p.m. MT · once", audience: "Eligible members with recorded Membership attendance, completed Timeline work and current access to revisit it." },
};
export function lifecycleCommunicationItems(overview: LifecycleEmailOverview | null): CommunicationItem[] {
  return LIFECYCLE_EMAIL_KEYS.map(key => {
    const item = overview?.items.find(entry => entry.key === key);
    const status = !item ? "attention" : !item.ready ? "held" : overview?.setupRequired ? "attention" : item.enabled && overview?.deliveryEnabled === false ? "paused" : item.enabled ? "enabled" : "approved";
    return { id: `lifecycle:${key}`, channel: "emails", bucket: key.startsWith("checkin_") ? "membership" : "misc", title: LIFECYCLE_TITLES[key],
      ...LIFECYCLE_DESCRIPTIONS[key], status, statusLabel: !item ? "Status unavailable" : !item.ready ? "Held" : overview?.setupRequired ? "Setup required" : item.enabled && overview?.deliveryEnabled === false ? "Delivery paused" : item.enabled ? "Enabled" : "Ready to enable",
      detail: item ? [...item.missing, "Counts and dates are current checks, not a guaranteed send. Permissions and dependencies are checked again before delivery."].join(" ") : "Load lifecycle settings to verify the current state. No active status is inferred.",
      action: { label: "Edit template & rules", href: `/ops/messages?mode=automations&lifecycle=${key}#lifecycle-emails` },
    };
  });
}
