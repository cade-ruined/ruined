export type MemberNotificationAnnouncement = {
  id: string;
  title: string;
  body: string;
  actionLabel: string | null;
  href: string | null;
  publishedAt: string;
};

export type MemberNotificationState = {
  ownerId: string;
  unreadCount: number;
  announcement: MemberNotificationAnnouncement | null;
};

export type MemberAnnouncementAction = "dismiss" | "open";

export class MemberNotificationError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "MemberNotificationError";
  }
}

export const MEMBER_NOTIFICATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Legacy notification snapshots are untrusted navigation, never executable URLs. */
export function safeMemberNotificationHref(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value || value.length > 2000
    || /[\u0000-\u0020\u007f-\u009f<>"'\\]/.test(value)
    || /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) return null;
  try {
    const base = "https://members.theruinedproject.com";
    const url = new URL(value, base);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (value.startsWith("/")) {
      if (url.origin !== base || !(url.pathname === "/my" || url.pathname.startsWith("/my/"))) return null;
      return `${url.pathname}${url.search}${url.hash}`;
    }
    if (!/^https:\/\//i.test(value)) return null;
    return url.href;
  } catch { return null; }
}
