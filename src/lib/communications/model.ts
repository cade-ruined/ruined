// Store and Artifacts remain valid persisted topics so historical consent and
// opt-outs can still be reconciled. Every new public signup uses only `about`,
// the canonical general Ruined updates audience.
export const COMMUNICATION_SOURCES = ["store", "artifacts", "about"] as const;

export type CommunicationSource = (typeof COMMUNICATION_SOURCES)[number];

export const GENERAL_COMMUNICATION_SOURCE = "about" satisfies CommunicationSource;

export const EMAIL_CONSENT_VERSION = "ruined-general-updates-v1";

export const EMAIL_CONSENT_NOTICES: Record<typeof GENERAL_COMMUNICATION_SOURCE, string> = {
  about: "Email me about Ruined updates. Unsubscribe anytime.",
};

export function normalizeCommunicationEmail(value: string): string {
  return value.trim().toLowerCase();
}
