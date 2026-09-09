/** Public inquiry context only. This is not a membership application or access grant. */
export type ContactTopic = "general" | "membership";

export function parseContactTopic(value: unknown): ContactTopic | null {
  if (value === undefined || value === "general") return "general";
  return value === "membership" ? "membership" : null;
}

/** Unrecognized or repeated URL parameters retain the ordinary contact form. */
export function contactTopicFromQuery(value: unknown): ContactTopic {
  return parseContactTopic(value) ?? "general";
}

export const CONTACT_CONFIRMATIONS: Record<ContactTopic, string> = {
  general: "Message received. We’ll reply by email.",
  membership:
    "Inquiry received. We’ll reply by email to discuss membership and next steps. Membership is by invitation.",
};
