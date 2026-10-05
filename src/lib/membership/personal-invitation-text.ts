/** Prepare a message only. Opening a composer never means the message was sent. */
export function personalInvitationText(input: {
  recipientName: string;
  recipientPhone: string;
  invitationUrl: string;
  inviterName: string;
  origin: string;
  userAgent?: string;
}): { body: string; href: string } | null {
  if (!/^\+[1-9]\d{6,14}$/.test(input.recipientPhone)) return null;
  let invitationUrl: URL;
  try {
    invitationUrl = new URL(input.invitationUrl, input.origin);
    if (invitationUrl.origin !== new URL(input.origin).origin
      || !/^https?:$/.test(invitationUrl.protocol)
      || !/^\/invitation\/[A-Za-z0-9_-]{43}$/.test(invitationUrl.pathname)
      || invitationUrl.search || invitationUrl.hash) return null;
  } catch { return null; }
  const name = input.recipientName.trim().replace(/\s+/g, " ");
  const inviter = input.inviterName.trim().replace(/\s+/g, " ");
  const body = `${name}, here’s your personal invitation to Ruined from ${inviter}. Explore Membership and accept your invitation here:\n${invitationUrl.href}`;
  // RFC 5724 defines ?body=. Apple Messages uses &body= for prefilled text.
  // Copy link stays available for devices without a compatible SMS handler.
  const separator = /iPhone|iPad|iPod|Macintosh|Mac OS X/i.test(input.userAgent ?? "") ? "&" : "?";
  return { body, href: `sms:${input.recipientPhone}${separator}body=${encodeURIComponent(body)}` };
}
