import type { Metadata } from "next";
import preview from "./sharing-previews.json";
import { SITE_URL } from "./site";

/** Default approved artwork for public links without a specific product photo. */
export function sharingImage() {
  return {
    url: `${SITE_URL}/${preview.source}`,
    width: preview.width,
    height: preview.height,
    alt: preview.alt,
  };
}

function socialText(value: string) {
  return value.replace(/<[^>]*>/g, " ").replace(/\bgarments\b/gi, (word) =>
    /^[A-Z]/.test(word) ? "Apparel" : "apparel",
  ).replace(/\s+/g, " ").trim();
}

/** Next replaces nested metadata objects; always define both channels together. */
export function sharingMetadata({ title, description, path, image }: {
  title: string;
  description: string;
  path: string;
  image?: {
    url: string;
    alt: string;
    width?: number;
    height?: number;
  };
}): Pick<Metadata, "openGraph" | "twitter"> {
  const cleanTitle = socialText(title);
  const socialTitle = /\bRuined\b/i.test(cleanTitle)
    ? cleanTitle : `${cleanTitle} — Ruined`;
  const socialDescription = socialText(description);
  const socialImages = [image
    ? { ...image, url: new URL(image.url, SITE_URL).href }
    : sharingImage()];
  return {
    openGraph: {
      type: "website",
      siteName: "Ruined",
      title: socialTitle,
      description: socialDescription,
      url: new URL(path, SITE_URL).href,
      images: socialImages,
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description: socialDescription,
      images: socialImages,
    },
  };
}

/** Sharing an account URL must not inherit a marketing card or a home canonical. */
export const privateSharingMetadata: Metadata = {
  openGraph: null,
  twitter: null,
  alternates: { canonical: null },
};
