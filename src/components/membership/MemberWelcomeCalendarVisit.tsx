"use client";

import { useEffect } from "react";

/** Mark actual Calendar visits after hydration, never from a server prefetch. */
export default function MemberWelcomeCalendarVisit({ ownerId, preview = false }: {
  ownerId: string;
  preview?: boolean;
}) {
  useEffect(() => {
    if (preview || !ownerId) return;
    const controller = new AbortController();
    // The server preserves the first visit and rechecks this exact owner and
    // profile access. A failed optional update must never interrupt Calendar.
    void fetch("/api/my/welcome", {
      method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      headers: { "Content-Type": "application/json", "x-ruined-session-owner": ownerId },
      body: JSON.stringify({ action: "calendar_viewed", ownerId }),
    }).catch(() => { /* A later visit can retry without blocking this one. */ });
    return () => controller.abort();
  }, [ownerId, preview]);
  return null;
}
