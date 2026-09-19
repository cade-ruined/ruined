"use client";

import { useEffect, useState } from "react";
import { memberInvitationExpired } from "@/lib/membership/invitation-expiry";

/** Recheck after a sleeping tab wakes, as well as at the exact deadline. */
export function useInvitationExpired(expiresAt: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (timer) clearTimeout(timer);
      const current = Date.now(); setNow(current);
      const remaining = expiresAt ? Date.parse(expiresAt) - current : NaN;
      if (remaining > 0) timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
    };
    check(); window.addEventListener("focus", check); document.addEventListener("visibilitychange", check);
    return () => { if (timer) clearTimeout(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [expiresAt]);
  return memberInvitationExpired(expiresAt, now);
}
