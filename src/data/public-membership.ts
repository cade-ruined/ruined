/** Public editorial copy only. Replace these studies with approved membership
 * photography as it becomes available; no member identities are exposed here.
 */
export const MEMBERSHIP_INTRO = {
  headline: "Good company. Real work.",
  description:
    "A private membership for people making something of their lives. A place to learn, find your people, and put intention into practice.",
  image: "/after-the-fear-hero.webp",
  alt: "Editorial study of a figure moving through a concrete passage toward the light.",
} as const;

export const MEMBERSHIP_PILLARS = [
  {
    id: "foundations",
    title: "Foundations",
    summary:
      "A guided starting point. Look honestly at where you are, what belongs, and what you want to build next.",
    image: "/membership/archive-material-placeholder.webp",
    alt: "Editorial material study of dark cloth, worked metal, and unfinished paper on a worktable.",
  },
  {
    id: "circle",
    title: "Your Circle",
    summary:
      "Up to ten members, guided by a Shaper. A smaller place for honest conversation, shared work, and showing up for one another.",
    image: "/ruined-hero-lounge.jpg",
    alt: "An imagined gathering space with worn leather seating and a low table; temporary editorial imagery.",
  },
  {
    id: "academy",
    title: "Academy",
    summary:
      "Training videos, focused lessons, and resources to return to. Learn something, try it, then come back with better questions.",
    image: "/art/records.jpg",
    alt: "Editorial study of a record archive in a warm, concrete-walled room.",
  },
  {
    id: "experiences",
    title: "Experiences",
    summary:
      "Time together beyond the screen. Find upcoming gatherings, see the details, and make room to be there.",
    image: "/events/byob-01/gallery/01-img-8059.webp",
    alt: "A group at a past Ruined BYOB community gathering beside Tibble Fork Reservoir.",
  },
] as const;

export const MEMBERSHIP_LINKS = {
  inquire: "/contact?topic=membership",
  signIn: "https://members.theruinedproject.com/access",
} as const;
