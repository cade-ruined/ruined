"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { MARKETING_CONSENT_EVENT } from "@/lib/marketing/consent";
import { configureStoreAnalytics, refreshStoreAnalytics, trackStoreEvent } from "@/lib/analytics/storefront";
import type { ShopifyAnalyticsConfig } from "@/lib/analytics/shopify";

export default function StorefrontAnalytics({ config }: { config: ShopifyAnalyticsConfig }) {
  const pathname = usePathname();
  useEffect(() => {
    configureStoreAnalytics(config);
    window.addEventListener(MARKETING_CONSENT_EVENT, refreshStoreAnalytics);
    window.dispatchEvent(new Event(MARKETING_CONSENT_EVENT));
    return () => {
      window.removeEventListener(MARKETING_CONSENT_EVENT, refreshStoreAnalytics);
      // The root layout owns this document-wide integration. StrictMode replays
      // effect cleanup; consent/pagehide events own cancellation instead.
    };
  }, [config]);
  useEffect(() => {
    refreshStoreAnalytics();
    const sent = new Set<number>();
    const scroll = () => {
      const height = document.documentElement.scrollHeight - window.innerHeight;
      if (height < 200) return;
      const percent = Math.min(100, Math.round(window.scrollY / height * 100));
      for (const milestone of [25, 50, 75, 100]) {
        if (percent >= milestone && !sent.has(milestone) && trackStoreEvent("store_scroll_depth", { percent: milestone })) sent.add(milestone);
      }
    };
    window.addEventListener("scroll", scroll, { passive: true });
    return () => window.removeEventListener("scroll", scroll);
  }, [pathname]);
  return null;
}
