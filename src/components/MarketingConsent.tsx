"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  isMarketingPage, marketingConsentAllowed, MARKETING_CONSENT_EVENT, MARKETING_PREFERENCES_EVENT,
  type MarketingConfig,
} from "@/lib/marketing/consent";
import { configureMetaTracking, grantMetaTracking, hasLocalMarketingVeto, revokeMetaTracking, trackMetaPageView, vetoMetaTracking } from "@/lib/marketing/meta";

let privacyScript: Promise<void> | undefined;
function loadPrivacyApi() {
  privacyScript ??= new Promise<void>((resolve, reject) => {
    if (window.Shopify?.customerPrivacy?.setTrackingConsent) { resolve(); return; }
    const script = document.createElement("script");
    script.id = "ruined-customer-privacy";
    script.src = "https://cdn.shopify.com/shopifycloud/consent-tracking-api/v0.1/consent-tracking-api.js";
    script.async = true;
    script.onload = () => window.Shopify?.customerPrivacy?.setTrackingConsent ? resolve() : reject(new Error("Privacy preferences unavailable."));
    script.onerror = () => { privacyScript = undefined; reject(new Error("Privacy preferences unavailable.")); };
    document.head.appendChild(script);
  });
  return privacyScript;
}

export default function MarketingConsent({ config }: { config: MarketingConfig }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [gpc, setGpc] = useState(false);
  const pending = useRef(false);
  const failed = useRef(false);
  const attempt = useRef(0);

  useEffect(() => {
    let active = true;
    const hostAllowed = window.location.hostname === config.storefrontRootDomain
      || window.location.hostname === `www.${config.storefrontRootDomain}`;
    configureMetaTracking(hostAllowed);
    const refresh = () => {
      const privacy = window.Shopify?.customerPrivacy;
      if (!active || !privacy) return;
      const browserOptOut = window.navigator.globalPrivacyControl === true;
      setGpc(browserOptOut);
      setReady(true);
      const consent = privacy.currentVisitorConsent();
      if (!consent.marketing || !consent.analytics) setOpen(true);
      if (pending.current || failed.current || hasLocalMarketingVeto() || !marketingConsentAllowed(privacy, browserOptOut)) revokeMetaTracking();
      else { grantMetaTracking(); trackMetaPageView(); }
      window.dispatchEvent(new Event(MARKETING_CONSENT_EVENT));
    };
    const show = () => { setOpen(true); };
    window.addEventListener(MARKETING_PREFERENCES_EVENT, show);
    document.addEventListener("visitorConsentCollected", refresh);
    if (hostAllowed) void loadPrivacyApi().then(refresh).catch(() => {
      if (active) setError("Cookie preferences are unavailable. Optional tracking remains off. Please try again later.");
    });
    return () => {
      active = false;
      configureMetaTracking(false);
      revokeMetaTracking();
      window.removeEventListener(MARKETING_PREFERENCES_EVENT, show);
      document.removeEventListener("visitorConsentCollected", refresh);
    };
  }, [config]);

  useEffect(() => {
    if (!isMarketingPage(pathname)) revokeMetaTracking();
    else if (ready && !pending.current && !failed.current) {
      grantMetaTracking();
      trackMetaPageView();
      window.dispatchEvent(new Event(MARKETING_CONSENT_EVENT));
    }
  }, [pathname, ready]);

  function choose(allow: boolean) {
    const privacy = window.Shopify?.customerPrivacy;
    if (!privacy || saving || (allow && gpc)) return;
    const request = ++attempt.current;
    pending.current = true;
    failed.current = false;
    setSaving(true);
    setError("");
    // A failed decline must not resume tracking on the next page load.
    if (!allow) vetoMetaTracking();
    else revokeMetaTracking();
    const timeout = window.setTimeout(() => {
      if (request !== attempt.current) return;
      // Do not start concurrent SDK writes: an older response could overwrite
      // a more recent cookie choice. The pending request can still finish.
      failed.current = true;
      setError("Saving your choice is taking longer than expected. Optional tracking remains off while we wait.");
      revokeMetaTracking();
    }, 15000);
    privacy.setTrackingConsent({ ...config, headlessStorefront: true, marketing: allow, analytics: allow }, (result) => {
      if (request !== attempt.current) return;
      window.clearTimeout(timeout);
      pending.current = false;
      setSaving(false);
      if (result?.error) {
        failed.current = true;
        configureMetaTracking(false);
        revokeMetaTracking();
        setError("Your choice could not be saved. Optional tracking remains off. Please try again.");
        return;
      }
      failed.current = false;
      setError("");
      configureMetaTracking(true);
      if (allow && marketingConsentAllowed(privacy, window.navigator.globalPrivacyControl === true)) { grantMetaTracking(true); trackMetaPageView(); }
      else revokeMetaTracking();
      window.dispatchEvent(new Event(MARKETING_CONSENT_EVENT));
      setOpen(false);
    });
  }

  if (!isMarketingPage(pathname) && !open) return null;
  if (!open) return pathname === "/" && ready ? (
    <button type="button" onClick={() => setOpen(true)} className="fixed bottom-3 left-4 z-50 min-h-11 px-2 text-[0.65rem] text-white/60 underline underline-offset-4 hover:text-white">Cookie preferences</button>
  ) : null;

  return (
    <section aria-label="Cookie preferences" className="fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-2xl border border-white/20 bg-[#11100e] p-5 text-[var(--color-bone)] shadow-2xl sm:bottom-5 sm:p-6">
      <p className="font-mono text-xs uppercase tracking-[0.2em]">Optional cookies</p>
      <p className="mt-3 text-sm leading-relaxed text-white/75">With your permission, Meta uses cookies to measure visits and product activity and help Ruined show relevant ads. Shopify saves your choice for checkout. Shopping works without these cookies. <Link href="/privacy" className="underline underline-offset-4">Privacy policy</Link></p>
      {gpc && <p className="mt-3 text-sm text-white/70">Your browser’s privacy signal keeps marketing tracking off.</p>}
      {error && <p role="status" className="mt-3 text-sm text-white/80">{error}</p>}
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" disabled={!ready || saving} onClick={() => choose(false)} className="min-h-11 flex-1 border border-white/60 px-4 py-3 text-xs disabled:opacity-40">Reject optional cookies</button>
        <button type="button" disabled={!ready || saving || gpc} onClick={() => choose(true)} className="min-h-11 flex-1 border border-white/60 px-4 py-3 text-xs disabled:opacity-40">Allow optional cookies</button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-3 text-xs underline underline-offset-4">Close</button>
      </div>
    </section>
  );
}
