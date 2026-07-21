"use client";

import { useReportWebVitals } from "next/web-vitals";

export default function WebVitals() {
  useReportWebVitals((metric) => {
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
