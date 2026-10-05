import "server-only";

/** The server proposes the date once, when reserving the offer. Existing offers
 * and accepted purchases always use their immutable database snapshot instead. */
export function getMembershipFirstChargeAt(now = new Date()): Date | null {
  const configured = process.env.STRIPE_MEMBERSHIP_FIRST_CHARGE_AT?.trim();
  if (!configured) return null;
  // Require an explicit, second-precision UTC instant; never infer the server zone.
  const firstChargeAt = new Date(configured);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?Z$/.test(configured) ||
    !Number.isFinite(firstChargeAt.getTime()) || firstChargeAt.toISOString().replace(".000Z", "Z") !== configured.replace(".000Z", "Z")) {
    throw new Error("Membership first-charge configuration is invalid.");
  }
  return firstChargeAt.getTime() > now.getTime() ? firstChargeAt : null;
}

export function membershipFirstChargeDisclosure(firstChargeAt: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "long", day: "numeric", year: "numeric" }).format(firstChargeAt);
}
