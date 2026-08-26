/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";
const checkoutHostname = process.env.SHOPIFY_CHECKOUT_DOMAIN?.trim().toLowerCase();
const checkoutOrigin =
  checkoutHostname && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(checkoutHostname)
    ? ` https://${checkoutHostname}`
    : "";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://js.stripe.com https://*.js.stripe.com https://checkout.stripe.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://cdn.shopify.com https://*.stripe.com https://*.link.com",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.myshopify.com https://cdn.shopify.com https://api.stripe.com https://checkout.stripe.com https://link.com https://*.link.com",
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
  reactStrictMode: true,
  images: {
    // Prefer modern formats for any next/image usage; the hero <picture>
    // already serves AVIF/WebP directly.
    formats: ["image/avif", "image/webp"],
    // Sequence stills carry a content-version query. Explicitly allow local
    // image URLs with queries while retaining the existing all-local policy.
    localPatterns: [{ pathname: "/**" }],
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
    ];
  },
};

export default nextConfig;
