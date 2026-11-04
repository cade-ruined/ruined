/** Shared presentation contract. Importing this module never reads configuration or sends. */
export const MEMBER_SMS_ONE_OFF_INPUT_LIMIT = 900;
export const MEMBER_SMS_ONE_OFF_BODY_LIMIT = 1000;
export const MEMBER_SMS_ONE_OFF_PREFIX = "Ruined: ";
export const MEMBER_SMS_ONE_OFF_FOOTER = "\n\nReply STOP to unsubscribe or HELP for help.";
export const MEMBER_SMS_ONE_OFF_REVIEW_MINUTES = 15;

export class MemberSmsOneOffError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = "MemberSmsOneOffError"; }
}
export function renderMemberSmsOneOffBody(message: string): string {
  if (typeof message !== "string" || message.length > MEMBER_SMS_ONE_OFF_INPUT_LIMIT
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message)) {
    throw new MemberSmsOneOffError(400, `Keep the message to ${MEMBER_SMS_ONE_OFF_INPUT_LIMIT} characters without control characters.`);
  }
  const content = message.replace(/\r\n?/g, "\n").trim();
  if (!content) throw new MemberSmsOneOffError(400, "Write a membership text to review.");
  const body = `${MEMBER_SMS_ONE_OFF_PREFIX}${content}${MEMBER_SMS_ONE_OFF_FOOTER}`;
  if (body.length > MEMBER_SMS_ONE_OFF_BODY_LIMIT) throw new MemberSmsOneOffError(400, "That text is too long.");
  return body;
}
export function isMemberSmsOneOffBody(body: unknown): body is string {
  if (typeof body !== "string" || body.length > MEMBER_SMS_ONE_OFF_BODY_LIMIT
    || !body.startsWith(MEMBER_SMS_ONE_OFF_PREFIX) || !body.endsWith(MEMBER_SMS_ONE_OFF_FOOTER)) return false;
  try { return renderMemberSmsOneOffBody(body.slice(MEMBER_SMS_ONE_OFF_PREFIX.length, -MEMBER_SMS_ONE_OFF_FOOTER.length)) === body; }
  catch { return false; }
}
export type MemberSmsOneOffConfiguration = { enabled: boolean; ready: boolean; issues: string[] };
export type MemberSmsOneOffRecipient = {
  memberId: string; name: string; maskedPhone: string; sharedPhone: boolean; consentState: "opted_in";
};
export type MemberSmsOneOffSearch = {
  recipients: MemberSmsOneOffRecipient[]; hasMore: boolean; configuration: MemberSmsOneOffConfiguration;
};
export type MemberSmsOneOffReview = {
  id: string; recipient: MemberSmsOneOffRecipient; body: string; createdAt: string; expiresAt: string; status: "reviewed";
};
export type MemberSmsOneOffReviewResponse = { review: MemberSmsOneOffReview; configuration: MemberSmsOneOffConfiguration };
export type MemberSmsOneOffSendResult = {
  reviewId: string; status: "accepted" | "blocked" | "unknown" | "duplicate";
  attemptId: string | null; message: string; deliveryStatus: string | null;
};
export type MemberSmsOneOffRequestRecord = {
  id: string;
  recipient: MemberSmsOneOffRecipient;
  body: string;
  actorName: string;
  createdAt: string;
  claimedAt: string | null;
  status: "claimed" | "finished";
  outcome: string | null;
};
