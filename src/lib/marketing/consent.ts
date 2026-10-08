export const MARKETING_PREFERENCES_EVENT = "ruined:marketing-preferences";
export const MARKETING_CONSENT_EVENT = "ruined:marketing-consent";
export const META_PIXEL_ID = "2600338147062560";

export type MarketingConfig = {
  storefrontAccessToken: string;
  checkoutRootDomain: string;
  storefrontRootDomain: string;
};

export type ConsentChoice = "yes" | "no" | "";
export type VisitorConsent = Partial<Record<"marketing" | "analytics" | "preferences" | "saleOfData", boolean>>;
export type CustomerPrivacy = {
  consentStatus?: "loading" | "loaded";
  config?: { isHeadless?: boolean; asyncConsent?: boolean; asyncVisitorState?: boolean; consentDomain?: string; storefrontAccessToken?: string; injectedConsent?: string };
  currentVisitorConsent(): { marketing: ConsentChoice; analytics: ConsentChoice; preferences?: ConsentChoice; sale_of_data?: ConsentChoice };
  marketingAllowed(): boolean;
  analyticsProcessingAllowed(): boolean;
  saleOfDataAllowed(): boolean;
  setTrackingConsent(
    consent: MarketingConfig & { headlessStorefront: true; marketing: boolean; analytics: boolean },
    callback: (result?: { error?: unknown }) => void,
  ): void;
};

/** Explicit permission is required even where Shopify's regional default allows processing. */
export function marketingConsentAllowed(privacy: CustomerPrivacy | undefined, globalPrivacyControl = false): boolean {
  if (!privacy || privacy.consentStatus !== "loaded" || globalPrivacyControl) return false;
  try {
    const choice = privacy.currentVisitorConsent();
    return choice.marketing === "yes" && choice.analytics === "yes"
      && privacy.marketingAllowed() && privacy.analyticsProcessingAllowed() && privacy.saleOfDataAllowed();
  } catch {
    return false;
  }
}

let consentUpdatePending = true;
export function setConsentUpdatePending(pending: boolean) { consentUpdatePending = pending; }

/** Unknown choices stay omitted; regional processing defaults are not a choice. */
export function visitorConsentForCheckout(privacy: CustomerPrivacy | undefined, localVeto = false, globalPrivacyControl = false): VisitorConsent | undefined {
  let result: VisitorConsent = {};
  if (privacy?.consentStatus === "loaded" && !consentUpdatePending) {
    try {
      const choice = privacy.currentVisitorConsent();
      for (const [source, target] of [["marketing", "marketing"], ["analytics", "analytics"], ["preferences", "preferences"], ["sale_of_data", "saleOfData"]] as const) {
        if (choice[source] === "yes") result[target] = true;
        else if (choice[source] === "no") result[target] = false;
      }
    } catch { result = {}; }
  }
  if (localVeto) { result.marketing = false; result.analytics = false; }
  if (globalPrivacyControl) { result.marketing = false; result.saleOfData = false; }
  return Object.keys(result).length ? result : undefined;
}

export function validVisitorConsent(value: unknown): value is VisitorConsent | undefined {
  return value === undefined || (value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.entries(value).every(([key, choice]) => ["marketing", "analytics", "preferences", "saleOfData"].includes(key) && typeof choice === "boolean"));
}

export function isMarketingPage(pathname: string): boolean {
  return pathname === "/" || pathname === "/store" || pathname === "/bag"
    || /^\/store\/[a-z0-9][a-z0-9-]*\/?$/.test(pathname);
}

export function publicMarketingConfig(environment: Record<string, string | undefined>): MarketingConfig | null {
  const token = environment.SHOPIFY_STOREFRONT_ACCESS_TOKEN?.trim();
  // The existing Storefront client uses publicAccessToken. Never expose an Admin/private token.
  if (environment.META_TRACKING_ENABLED !== "true" || !token || !/^[a-f0-9]{32}$/i.test(token)
    || environment.SHOPIFY_CHECKOUT_DOMAIN?.trim().toLowerCase() !== "checkout.theruinedproject.com") return null;
  return { storefrontAccessToken: token, checkoutRootDomain: "checkout.theruinedproject.com", storefrontRootDomain: "theruinedproject.com" };
}
