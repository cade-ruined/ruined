export const SUPPORT_EMAIL = "connect@theruinedproject.com";

export const SUPPORT_CATEGORIES = [
  { value: "account", label: "Account & sign-in" },
  { value: "billing", label: "Membership & billing" },
  { value: "circle", label: "Circle & placement" },
  { value: "foundations", label: "Foundations" },
  { value: "academy", label: "Academy & videos" },
  { value: "experiences", label: "Events & experiences" },
  { value: "artifacts", label: "Artifacts & orders" },
  { value: "other", label: "Something else" },
] as const;

export const SUPPORT_STATUSES = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting_on_member", label: "Waiting for you" },
  { value: "resolved", label: "Resolved" },
] as const;

export type SupportCategory = typeof SUPPORT_CATEGORIES[number]["value"];
export type SupportStatus = typeof SUPPORT_STATUSES[number]["value"];
export type SupportTicketSummary = {
  id: string;
  number: string;
  subject: string;
  category: SupportCategory;
  status: SupportStatus;
  requesterName: string;
  requesterEmail: string;
  createdAt: string;
  updatedAt: string;
  emailAttentionCount?: number;
};
export type SupportMessage = {
  id: string;
  authorType: "member" | "operator";
  body: string;
  createdAt: string;
};
export type SupportEmailDelivery = SupportDeliveryRow & {
  id: string;
  audience: "operator" | "member";
  created_at: string;
  sent_at: string | null;
};
export type SupportTicket = SupportTicketSummary & { messages: SupportMessage[]; emailDeliveries?: SupportEmailDelivery[] };

export class SupportError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "SupportError";
  }
}

export function supportCategoryLabel(value: string): string {
  return SUPPORT_CATEGORIES.find((category) => category.value === value)?.label ?? value;
}

export function supportStatusLabel(value: string, operator = false): string {
  if (operator && value === "waiting_on_member") return "Waiting for member";
  return SUPPORT_STATUSES.find((status) => status.value === value)?.label ?? value;
}

export function supportText(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string") throw new SupportError(400, `${label} is required.`);
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw new SupportError(400, `${label} must be ${min}–${max} characters.`);
  }
  return text;
}

export function supportUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new SupportError(400, "This request is invalid. Refresh and try again.");
  }
  return value.toLowerCase();
}

export function supportCategory(value: unknown): SupportCategory {
  if (!SUPPORT_CATEGORIES.some((category) => category.value === value)) {
    throw new SupportError(400, "Choose a help topic.");
  }
  return value as SupportCategory;
}

export function supportStatus(value: unknown): SupportStatus {
  if (!SUPPORT_STATUSES.some((status) => status.value === value)) {
    throw new SupportError(400, "Choose a valid status.");
  }
  return value as SupportStatus;
}
import type { SupportDeliveryRow } from "@/lib/support/delivery-policy";
