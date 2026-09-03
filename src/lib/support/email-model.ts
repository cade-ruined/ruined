type SupportNotificationInput = {
  audience: "operator" | "member";
  authorType: "operator" | "member";
  ticketId: string;
  ticketNumber: string;
  siteUrl: URL;
};

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// Keep email deliberately spare: personal questions stay behind sign-in.
// The payload does not depend on mutable subject, category, status, or profile data,
// so a retry with the same provider idempotency key has the exact same content.
export function createSupportNotificationEmail(input: SupportNotificationInput) {
  const number = `R-${input.ticketNumber.padStart(6, "0")}`;
  const ticketUrl = new URL(
    `${input.audience === "operator" ? "/ops" : "/my"}/support/${input.ticketId}`,
    input.siteUrl,
  ).toString();
  const heading = input.audience === "operator"
    ? "A support request needs you."
    : input.authorType === "operator"
      ? "You have a reply."
      : "Your request is with us.";
  const sentence = input.audience === "operator"
    ? `Open ${number} to read the member’s request and reply.`
    : input.authorType === "operator"
      ? `There’s a new reply to ${number}. Open your request to continue the conversation.`
      : `We’ve saved ${number}. You can add details and follow replies in Ruined.`;
  const footer = "Reply in Ruined to keep everything together. Replies to this email are not added to your ticket.";
  const logo = new URL("/ruined-wordmark-email.png", input.siteUrl).toString();

  return {
    subject: `Ruined support · ${number}`,
    text: [heading, "", sentence, "", `Reply in Ruined: ${ticketUrl}`, "", footer].join("\n"),
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#E5E0D5;color:#2A2A2A;font-family:Arial,Helvetica,sans-serif"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:32px 24px"><table role="presentation" style="width:100%;max-width:560px;margin:0 auto;border-collapse:collapse"><tr><td style="padding-bottom:32px"><img src="${escapeHtml(logo)}" width="150" alt="Ruined" style="display:block;max-width:100%;height:auto"></td></tr><tr><td><span style="display:inline-block;background:#FFCA2C;color:#2A2A2A;padding:6px 10px;font-size:13px;font-weight:700">SUPPORT / ${escapeHtml(number)}</span><h1 style="font-family:Georgia,serif;font-size:36px;font-weight:400;line-height:1.1;margin:20px 0">${escapeHtml(heading)}</h1><p style="font-size:16px;line-height:1.6;margin:0 0 24px">${escapeHtml(sentence)}</p><a href="${escapeHtml(ticketUrl)}" style="display:inline-block;background:#2A2A2A;color:#E5E0D5;border-radius:4px;padding:14px 20px;font-weight:700;text-decoration:none">Reply in Ruined →</a><p style="font-size:12px;line-height:1.6;margin:28px 0 0;color:#58564F">${escapeHtml(footer)}</p></td></tr></table></td></tr></table></body></html>`,
  };
}
