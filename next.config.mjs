/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Prefer modern formats for any next/image usage; the hero <picture>
    // already serves AVIF/WebP directly.
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
