import { safeMemberNotificationHref, type MemberNotificationState } from "./notification-inbox-model";

export const MEMBER_UPDATES_CHANGED = "ruined:member-updates";

export function canPresentMemberAnnouncement(pathname: string) {
  return ["/my", "/my/library", "/my/circle", "/my/experiences"].includes(pathname);
}

function parseState(value: unknown, ownerId: string): MemberNotificationState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as MemberNotificationState;
  if (state.ownerId !== ownerId || !Number.isSafeInteger(state.unreadCount) || state.unreadCount < 0) return null;
  const item = state.announcement;
  if (item !== null && (!item || typeof item.id !== "string" || typeof item.title !== "string"
    || typeof item.body !== "string" || typeof item.publishedAt !== "string"
    || !Number.isFinite(Date.parse(item.publishedAt)) || (item.actionLabel !== null && typeof item.actionLabel !== "string")
    || (item.href !== null && (typeof item.href !== "string" || safeMemberNotificationHref(item.href) !== item.href)))) return null;
  return state;
}

/** One account-bound lifecycle. Late requests cannot restore an old account's notice. */
export function createMemberNotificationSession({ ownerId, onChange, request = fetch }: {
  ownerId: string;
  onChange: (state: MemberNotificationState | null) => void;
  request?: typeof fetch;
}) {
  let controller = new AbortController();
  let stopped = false;
  let revision = 0;
  let writing = false;
  let refreshAfterWrite = false;
  let state: MemberNotificationState | null = null;
  function invalidate() {
    controller.abort(); controller = new AbortController(); revision++;
    state = null; onChange(null);
  }
  function current(version: number) { return !stopped && !controller.signal.aborted && revision === version; }
  async function refresh() {
    if (stopped) return;
    if (writing) { refreshAfterWrite = true; return; }
    const version = ++revision;
    try {
      const response = await request("/api/my/updates/notification-state", {
        cache: "no-store", signal: controller.signal, headers: { "x-ruined-session-owner": ownerId },
      });
      if (!current(version)) return;
      if ([401, 403, 409].includes(response.status)) { invalidate(); return; }
      if (!response.ok) return;
      const value = await response.json();
      if (!current(version)) return;
      if (value?.ownerId !== ownerId) { invalidate(); return; }
      const next = parseState(value, ownerId);
      if (next) { state = next; onChange(next); }
    } catch { /* Keep the last confirmed count; retry on the next visit or focus. */ }
  }
  async function acknowledge(notificationId: string, action: "dismiss" | "open") {
    if (stopped || writing || state?.announcement?.id !== notificationId) return false;
    writing = true;
    const version = ++revision;
    try {
      const response = await request("/api/my/updates/announcement", { method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json", "x-ruined-session-owner": ownerId },
        body: JSON.stringify({ ownerId, notificationId, action }) });
      if (!current(version)) return false;
      if ([401, 403, 409].includes(response.status)) { invalidate(); return false; }
      const result = await response.json();
      if (!current(version)) return false;
      if (!response.ok || result?.ok !== true) throw new Error("Your update couldn’t be saved. Please try again.");
      if (result.ownerId !== ownerId) { invalidate(); return false; }
      state = { ...state!, announcement: null, unreadCount: action === "open" ? Math.max(0, state!.unreadCount - 1) : state!.unreadCount };
      onChange(state);
      return true;
    } finally {
      writing = false;
      if (refreshAfterWrite && !stopped) { refreshAfterWrite = false; void refresh(); }
    }
  }
  return { refresh, acknowledge, stop: () => { stopped = true; controller.abort(); } };
}
