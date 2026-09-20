/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";
const checkoutHostname = process.env.SHOPIFY_CHECKOUT_DOMAIN?.trim().toLowerCase();
const checkoutOrigin =
  checkoutHostname && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(checkoutHostname)
    ? ` https://${checkoutHostname}`
    : "";
const supabaseOrigin = (() => {
  try {
    const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    if (!configuredUrl) return "";
    const url = new URL(configuredUrl);
    return url.protocol === "https:" ? ` ${url.origin}` : "";
  } catch {
    return "";
  }
})();
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://js.stripe.com https://*.js.stripe.com https://checkout.stripe.com`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://cdn.shopify.com https://*.stripe.com https://*.link.com${supabaseOrigin}`,
  `media-src 'self' blob:${supabaseOrigin}`,
  "font-src 'self' data:",
  `connect-src 'self' https://*.myshopify.com https://cdn.shopify.com https://api.stripe.com https://checkout.stripe.com https://link.com https://*.link.com${supabaseOrigin}`,
  "frame-src https://js.stripe.com https://*.js.stripe.com https://checkout.stripe.com https://hooks.stripe.com https://link.com https://*.link.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  `form-action 'self' https://*.myshopify.com https://shop.app${checkoutOrigin}`,
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig = {
  // Keep a release check from overwriting the active local development cache.
  distDir: process.env.RUINED_BUILD_CHECK === "true" ? ".next-ops-build-check" : ".next",
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/",
        has: [{ type: "host", value: "members\\.theruinedproject\\.com" }],
        destination: "/access",
        permanent: false,
      },
    ];
  },
  images: {
    // Prefer modern formats for any next/image usage; the hero <picture>
    // already serves AVIF/WebP directly.
    formats: ["image/avif", "image/webp"],
    // Optimize static assets only. The optimizer caches upstream image bytes even
    // when their response says no-store; public card consent must stay revocable.
    // Omitted search preserves versioned sequence URLs. Member media uses unoptimized.
    localPatterns: [
      { pathname: "/*.{avif,gif,ico,jpg,jpeg,png,svg,webp}" },
      { pathname: "/_next/static/media/**" },
      ...["art", "catalog", "cursor", "events", "fonts", "media", "membership", "sequences", "sharing", "store", "textures", "work"]
        .map((directory) => ({ pathname: `/${directory}/**` })),
    ],
    remotePatterns: [
      { protocol: "https", hostname: "cdn.shopify.com", pathname: "/**" },
    ],
  },
  async headers() {
    return [
      {
        source: "/sequences/manifest.json",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      ...[
        "lobby",
        "store",
        "records",
        "lounge",
        "mobile",
        "fireside",
      ].map((room) => ({
        source: `/sequences/${room}/:path*`,
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=31536000, s-maxage=31536000, immutable",
          },
        ],
      })),
      ...[
        "/events/byob-01-recap.mp4",
        "/events/byob-01-recap-poster.webp",
        "/events/byob-01/gallery/:path*",
        // Versioned brand-only media; no member identity or invitation tokens.
        "/membership/card/share/:path*",
      ].map((source) => ({
        source,
        headers: [
          {
            key: "Cache-Control",
            value:
              "public, max-age=31536000, s-maxage=31536000, immutable",
          },
        ],
      })),
      { source: "/(.*)", headers: securityHeaders },
      ...["/card/:path*", "/invitation/:path*"].map(source => ({ source, headers: [
        { key: "Cache-Control", value: "private, no-store, max-age=0" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ] })),
    ];
  },
};

export default nextConfig;
