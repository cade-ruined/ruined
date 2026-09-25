import { memberInvitationDeadline } from "./invitation-expiry";

export type PersonalInvitationEmailInput = {
  invitationSource?: "member" | "ruined_direct";
  recipientName: string;
  inviterName: string;
  inviterTag: string | null;
  invitationUrl: string;
  expiresAt: string;
  siteUrl: URL;
  membershipType?: "standard" | "complimentary";
  complimentaryEndsAt?: string | null;
};

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** The worker persists this complete message before sending so retries stay identical. */
export function createPersonalInvitationEmail(input: PersonalInvitationEmailInput) {
  const recipient = input.recipientName.trim();
  const inviter = input.inviterName.trim() || "A Ruined member";
  const memberTag = input.inviterTag ? `@${input.inviterTag.replace(/^@/, "")}` : "";
  const tag = memberTag && inviter !== memberTag ? ` ${memberTag}` : "";
  const deadline = memberInvitationDeadline(input.expiresAt);
  if (!deadline) throw new Error("A valid invitation deadline is required.");
  const heading = `${recipient}, this is for you.`;
  const sentence = input.invitationSource === "ruined_direct"
    ? "Here is your personal invitation from The Ruined Project. Open your card to continue joining."
    : `${inviter}${tag} has sent you a personal invitation to Ruined.`;
  const expiry = `Your invitation is valid until ${deadline}.`;
  const benefit = input.membershipType === "complimentary"
    ? input.complimentaryEndsAt
      ? `Your membership is complimentary through ${memberInvitationDeadline(input.complimentaryEndsAt)}. No payment or card is needed to join.`
      : "Your membership is complimentary, with no scheduled end date. No payment or card is needed to join."
    : null;
  const footer = "This is a personal invitation, not a mailing list. You haven’t been subscribed to anything.";
  const logo = new URL("/ruined-wordmark-email.png", input.siteUrl).toString();

  return {
    subject: "A personal invitation to Ruined",
    text: [heading, "", sentence, "", "You’re allowed to become someone new.", "",
      `Open your invitation: ${input.invitationUrl}`, "", ...(benefit ? [benefit, ""] : []), expiry, "", footer].join("\n"),
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#E5E0D5;color:#2A2A2A;font-family:Arial,Helvetica,sans-serif"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:40px 24px"><table role="presentation" style="width:100%;max-width:560px;margin:0 auto;border-collapse:collapse"><tr><td style="padding-bottom:48px"><img src="${escapeHtml(logo)}" width="150" alt="Ruined" style="display:block;max-width:100%;height:auto"></td></tr><tr><td><p style="font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 20px">A personal invitation</p><h1 style="font-family:Georgia,serif;font-size:40px;font-weight:400;line-height:1.1;margin:0 0 24px">${escapeHtml(heading)}</h1><p style="font-size:16px;line-height:1.6;margin:0 0 20px">${escapeHtml(sentence)}</p><p style="font-family:Georgia,serif;font-size:23px;line-height:1.4;margin:0 0 32px">You’re allowed to become someone new.</p><a href="${escapeHtml(input.invitationUrl)}" style="display:inline-block;background:#2A2A2A;color:#E5E0D5;padding:16px 22px;font-weight:700;text-decoration:none">Open your invitation →</a>${benefit ? `<p style="font-size:16px;line-height:1.6;margin:24px 0 0">${escapeHtml(benefit)}</p>` : ""}<p style="font-size:12px;line-height:1.6;margin:24px 0 0">${escapeHtml(expiry)}</p><p style="font-size:12px;line-height:1.6;margin:48px 0 0;color:#58564F">${escapeHtml(footer)}</p></td></tr></table></td></tr></table></body></html>`,
  };
}
