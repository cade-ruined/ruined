"use client";

import { useReportWebVitals } from "next/web-vitals";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export default function WebVitals() {
  const pathname = usePathname();
  const hasShownMemberCard = useRef(false);
  useEffect(() => {
    if (pathname.startsWith("/card/") || pathname === "/my/card" || pathname.startsWith("/invitation/") || pathname === "/my/invitation") hasShownMemberCard.current = true;
  }, [pathname]);
  useReportWebVitals((metric) => {
    // Performance entries can contain complete capability and portrait URLs.
    // Once a card has been opened, also suppress delayed navigation metrics.
    if (hasShownMemberCard.current || window.location.pathname.startsWith("/card/") || window.location.pathname === "/my/card" || window.location.pathname.startsWith("/invitation/") || window.location.pathname === "/my/invitation") return;
    const endpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT;
    if (!endpoint) return;
    const payload = JSON.stringify(metric);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, payload);
    } else {
      void fetch(endpoint, {
        method: "POST",
        body: payload,
        keepalive: true,
        headers: { "content-type": "application/json" },
      });
    }
  });

  return null;
}
