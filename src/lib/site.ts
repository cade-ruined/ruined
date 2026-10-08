export const PRODUCTION_SITE_URL = "https://theruinedproject.com";

// Canonical metadata should never drift to a Vercel project URL or an old
// preview-domain environment value. The public brand origin is deliberate and
// shared by metadata, forms, robots, the sitemap, and structured data.
export const SITE_URL = PRODUCTION_SITE_URL;

// Public navigation must leave the membership host; its root is the shared
// sign-in entry point, not a second copy of the public website. Keep local
// development and the public deployment's navigation relative.
export function publicWebsiteHref(path: string) {
  const memberDeployment =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ===
    "https://members.theruinedproject.com";
  return memberDeployment ? `${PRODUCTION_SITE_URL}${path}` : path;
}


export const PRODUCTION_MEMBERSHIP_SITE_URL = "https://members.theruinedproject.com";

/** Send public-site entry points to the member deployment, including local previews. */
export function membershipWebsiteHref(path: string) {
  let origin = PRODUCTION_MEMBERSHIP_SITE_URL;
  const configured = process.env.NEXT_PUBLIC_MEMBERSHIP_SITE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
        url.pathname === "/" && !url.search && !url.hash) origin = url.origin;
    } catch {
      // A malformed optional override must never break the production destination.
    }
  }
  return `${origin}${path}`;
}
