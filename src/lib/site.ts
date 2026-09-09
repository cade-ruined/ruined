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
