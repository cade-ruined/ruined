import type { Metadata } from "next";
import EditorialPage from "@/components/EditorialPage";

const description =
  "Ruined exists to refine potential into identity through clothing, brands, products, and experiences.";

export const metadata: Metadata = {
  title: "About",
  description,
  alternates: { canonical: "/about" },
  openGraph: {
    type: "website",
    title: "About Ruined",
    description,
    url: "/about",
    images: [
      {
        url: "/opengraph-image.jpg",
        width: 1200,
        height: 630,
        alt: "The Ruined Project",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "About Ruined",
    description,
    images: ["/twitter-image.jpg"],
  },
};

export default function AboutPage() {
  return (
    <EditorialPage
      eyebrow="The Ruined Project"
      title="About Ruined."
      intro="Ruined exists to refine potential into identity. We believe what we become is shaped by what we choose to keep, change, and create. That belief runs through everything we do. From the people we work with to the clothing, brands, products, and experiences we create. Different outputs, same philosophy: remove what’s unnecessary, refine what matters, and create what deserves to exist."
      sections={[
        {
          title: "Still in process",
          body: (
            <p>
              This site is still being built. But like most things Ruined, we
              think you should see the process, not just the finished product.
              So come in. Look around. Consider this a walk through a small
              piece of our world while we’re still making it.
            </p>
          ),
        },
      ]}
    />
  );
}
