export const MARKETING_PREFERENCES_EVENT = "ruined:marketing-preferences";
export const MARKETING_CONSENT_EVENT = "ruined:marketing-consent";
export const META_PIXEL_ID = "2600338147062560";

export type MarketingConfig = {
  storefrontAccessToken: string;
  checkoutRootDomain: string;
  storefrontRootDomain: string;
};

export type ConsentChoice = "yes" | "no" | "";
export type CustomerPrivacy = {
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
  if (!privacy || globalPrivacyControl) return false;
  try {
    const choice = privacy.currentVisitorConsent();
    return choice.marketing === "yes" && choice.analytics === "yes"
      && privacy.marketingAllowed() && privacy.analyticsProcessingAllowed() && privacy.saleOfDataAllowed();
  } catch {
    return false;
  }
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
