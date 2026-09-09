import type { Metadata } from "next";

import MembersPage from "@/components/public-members/MembersPage";
import { MEMBERSHIP_INTRO } from "@/data/public-membership";

export const metadata: Metadata = {
  title: "Members",
  description: MEMBERSHIP_INTRO.description,
  alternates: { canonical: "/members" },
  openGraph: {
    type: "website",
    title: "Members — Ruined",
    description: MEMBERSHIP_INTRO.description,
    url: "/members",
    images: [{ url: MEMBERSHIP_INTRO.image, alt: MEMBERSHIP_INTRO.alt }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Members — Ruined",
    description: MEMBERSHIP_INTRO.description,
    images: [MEMBERSHIP_INTRO.image],
  },
};

export default function PublicMembersPage() {
  return <MembersPage />;
}
