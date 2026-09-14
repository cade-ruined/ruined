export type MembershipWaitlistSubmission = Readonly<{
  name: string;
  emailNormalized: string;
  phone: string | null;
}>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export function parseMembershipWaitlistInput(value: unknown): MembershipWaitlistSubmission | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.name !== "string" || typeof input.email !== "string") return null;
  if (CONTROL_CHARACTERS.test(input.name) || CONTROL_CHARACTERS.test(input.email)) return null;
  const name = input.name.trim().replace(/\s+/gu, " ");
  const emailNormalized = input.email.trim().toLowerCase();
  if (!name || Array.from(name).length > 100 || emailNormalized.length > 254 || !EMAIL_PATTERN.test(emailNormalized)) return null;

  if (input.phone !== undefined && input.phone !== null && typeof input.phone !== "string") return null;
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  if (phone && (phone.length > 40 || !/^\+?[\d ().-]+$/.test(phone) || !/^\d{7,15}$/.test(phone.replace(/\D/g, "")))) return null;
  return { name, emailNormalized, phone: phone || null };
}
