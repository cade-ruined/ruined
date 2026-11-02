import { isMarketingPage, type VisitorConsent } from "./consent";

export const PAID_ATTRIBUTION_STORAGE_KEY = "ruined:paid-attribution:v1";
export const PAID_ATTRIBUTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const ATTRIBUTION_ATTRIBUTE_PREFIX = "ruined_attribution_";
const SAME_VISIT_MS = 30 * 60 * 1000;
const SOURCES = new Set(["fb", "ig", "msg", "an", "facebook", "instagram", "messenger", "audience_network"]);
const MEDIUMS = new Set(["paid_social", "paid-social", "cpc", "ppc", "paid"]);
const ID = /^\d{1,32}$/;

/** Advertising IDs only: no customer data, click IDs, full URLs or query strings. */
export type PaidVisit = {
  at: string;
  source: string;
  medium: string;
  campaignId: string;
  adsetId?: string;
  adId?: string;
  landingPath: string;
};
export type PaidAttribution = { version: 1; first: PaidVisit; latest: PaidVisit };
export type AttributionAttribute = { key: string; value: string };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readVisit(value: unknown, now: number): PaidVisit | null {
  if (!record(value) || Object.keys(value).some(key => !["at", "source", "medium", "campaignId", "adsetId", "adId", "landingPath"].includes(key))
    || typeof value.at !== "string" || !Number.isFinite(Date.parse(value.at))
    || new Date(value.at).toISOString() !== value.at
    || Date.parse(value.at) > now + 5 * 60 * 1000 || Date.parse(value.at) <= now - PAID_ATTRIBUTION_TTL_MS
    || typeof value.source !== "string" || !SOURCES.has(value.source)
    || typeof value.medium !== "string" || !MEDIUMS.has(value.medium)
    || typeof value.campaignId !== "string" || !ID.test(value.campaignId)
    || (value.adsetId !== undefined && (typeof value.adsetId !== "string" || !ID.test(value.adsetId)))
    || (value.adId !== undefined && (typeof value.adId !== "string" || !ID.test(value.adId)))
    || typeof value.landingPath !== "string" || value.landingPath.length > 256 || !isMarketingPage(value.landingPath)) return null;
  return { at: value.at, source: value.source, medium: value.medium, campaignId: value.campaignId,
    ...(value.adsetId === undefined ? {} : { adsetId: value.adsetId as string }),
    ...(value.adId === undefined ? {} : { adId: value.adId as string }), landingPath: value.landingPath };
}

/** Revalidate untrusted storage/request data, pruning attribution outside 30 days. */
export function readPaidAttribution(value: unknown, now = Date.now()): PaidAttribution | null {
  if (!Number.isFinite(now) || !record(value) || value.version !== 1
    || Object.keys(value).some(key => !["version", "first", "latest"].includes(key))) return null;
  const latest = readVisit(value.latest, now);
  if (!latest) return null;
  const first = readVisit(value.first, now);
  if (!first && (!record(value.first) || typeof value.first.at !== "string"
    || Date.parse(value.first.at) > now - PAID_ATTRIBUTION_TTL_MS
    || !readVisit(value.first, Date.parse(value.first.at)))) return null;
  if (first && Date.parse(first.at) > Date.parse(latest.at)) return null;
  // The earliest retained visit, not a claim about the visitor's lifetime history.
  return { version: 1, first: first ?? latest, latest };
}

/** Future Meta ads use campaign/ad-set/ad IDs in campaign/term/content UTMs. */
export function paidVisitFromLocation(search: string, pathname: string, now = Date.now()): PaidVisit | null {
  if (search.length > 4096 || !Number.isFinite(now)) return null;
  const query = new URLSearchParams(search);
  const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
  if (keys.some(key => query.getAll(key).length > 1)) return null;
  const source = query.get("utm_source")?.toLowerCase();
  const medium = query.get("utm_medium")?.toLowerCase();
  const campaignId = query.get("utm_campaign");
  const adsetId = query.get("utm_term") ?? undefined;
  const adId = query.get("utm_content") ?? undefined;
  return readVisit({ at: new Date(now).toISOString(), source, medium, campaignId,
    ...(adsetId === undefined ? {} : { adsetId }), ...(adId === undefined ? {} : { adId }), landingPath: pathname }, now);
}

export function mergePaidAttribution(saved: unknown, current: PaidVisit | null, now = Date.now()): PaidAttribution | null {
  const previous = readPaidAttribution(saved, now);
  const visit = readVisit(current, now);
  if (!visit) return previous; // Direct, organic and internal navigation never replace a paid visit.
  if (!previous) return { version: 1, first: visit, latest: visit };
  const signature = (touch: PaidVisit) => JSON.stringify([touch.source, touch.medium, touch.campaignId, touch.adsetId, touch.adId]);
  if (signature(previous.latest) === signature(visit)
    && Date.parse(visit.at) - Date.parse(previous.latest.at) < SAME_VISIT_MS) return previous;
  return { version: 1, first: previous.first, latest: visit };
}

export function attributionConsentAllowed(consent: VisitorConsent | undefined): boolean {
  return consent?.marketing === true && consent.analytics === true && consent.saleOfData !== false;
}

/** These cart attributes become the Shopify order's additional details. */
export function paidAttributionAttributes(value: unknown, consent: VisitorConsent | undefined, now = Date.now()): AttributionAttribute[] {
  const attribution = attributionConsentAllowed(consent) ? readPaidAttribution(value, now) : null;
  if (!attribution) return [];
  const attributes: AttributionAttribute[] = [{ key: `${ATTRIBUTION_ATTRIBUTE_PREFIX}version`, value: "1" }];
  for (const touch of ["first", "latest"] as const) {
    const visit = attribution[touch];
    for (const [field, value_] of Object.entries(visit)) {
      attributes.push({ key: `${ATTRIBUTION_ATTRIBUTE_PREFIX}${touch}_${field}`, value: value_ });
    }
  }
  return attributes;
}

/** Only our namespace is replaced/removed; other apps' cart metadata survives. */
export function replaceAttributionAttributes(existing: AttributionAttribute[], managed: AttributionAttribute[]): AttributionAttribute[] {
  return [...existing.filter(attribute => !attribute.key.startsWith(ATTRIBUTION_ATTRIBUTE_PREFIX)), ...managed];
}
