/** Canonical tags contain no @; the prefix belongs to their presentation. */
export const MEMBER_TAG_PATTERN = /^[a-z0-9_]{3,24}$/;
export const MEMBER_TAG_UNIQUE_INDEX = "person_profiles_member_tag_unique";
export const MEMBER_TAG_UNAVAILABLE = "That member tag is already taken. Choose another.";

export class MemberTagValidationError extends Error {
  constructor() {
    super("Use 3–24 letters, numbers, or underscores for your member tag.");
    this.name = "MemberTagValidationError";
  }
}

/** Empty is handled by the writer, which knows whether this is a legacy profile. */
export function normalizeMemberTag(value: unknown): string | null {
  if (typeof value !== "string") throw new MemberTagValidationError();
  const trimmed = value.trim();
  if (!trimmed) return null;
  const tag = trimmed.replace(/^@/, "").toLowerCase();
  if (!MEMBER_TAG_PATTERN.test(tag)) throw new MemberTagValidationError();
  return tag;
}

/** Never label unrelated unique constraints as a tag conflict. */
export function isMemberTagConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const failure = error as Record<string, unknown>;
  return failure.code === "23505" &&
    (failure.constraint_name ?? failure.constraint) === MEMBER_TAG_UNIQUE_INDEX;
}
