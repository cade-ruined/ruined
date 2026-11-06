export const MEMBER_DESTINATIONS = [
  { href: "/my", label: "Profile", group: "Your record", keywords: "home journal writing saved entries achievements history attended milestones badges bio" },
  { href: "/my/badges", label: "Badges", group: "Your record", keywords: "collection earned progress achievements milestones patches" },
  { href: "/my/card", label: "My Card", group: "Your record", keywords: "public share flip portrait card download identity" },
  { href: "/my/invitation", label: "My Invitation", group: "Your record", keywords: "invite invitation referral people joined share" },
  { href: "/my/artifacts", label: "Artifacts", group: "Your record", keywords: "awards earned coin collection fulfillment tracking" },
  { href: "/my/timeline", label: "Timeline", group: "Your record", keywords: "public moments story reflections draft" },
  { href: "/my/circle", label: "Circle", group: "Your membership", keywords: "people shaper chat google meet group" },
  { href: "/my/members", label: "Members", group: "Your membership", keywords: "find browse people search directory name names tag tags handle public profiles" },
  { href: "/my/experiences", label: "Calendar", group: "Your membership", keywords: "events experiences calendar meetings calls rsvp attend" },
  { href: "/my/practice", label: "The Work", group: "Your membership", keywords: "practice foundations monthly time assignment progress course reflection MY 168" },
  { href: "/my/library", label: "Library", group: "Your membership", keywords: "academy learn training videos recordings replay replays lessons courses resources" },
  { href: "/my/updates", label: "Updates", group: "Your membership", keywords: "notifications announcements unread messages inbox" },
  { href: "/my/profile", label: "Edit profile", group: "Your account", keywords: "photo portrait name bio privacy visibility location timezone" },
  { href: "/my/account", label: "Account", group: "Your account", keywords: "membership billing payment subscription agreement settings" },
  { href: "/my/support", label: "Support", group: "Your account", keywords: "help contact connect ticket shipping address change phone" },
] as const;

export function currentMemberDestination(pathname: string): string | undefined {
  if (pathname === "/my/foundations" || pathname.startsWith("/my/foundations/")) return "/my/practice";
  if (pathname === "/my/learn" || pathname.startsWith("/my/learn/")) return "/my/library";
  return MEMBER_DESTINATIONS.filter(({ href }) => pathname === href || (href !== "/my" && pathname.startsWith(`${href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

export function findMemberDestinations(query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return MEMBER_DESTINATIONS.filter(({ label, keywords }) => words.every((word) => `${label} ${keywords}`.toLowerCase().includes(word)));
}


export const MEMBER_PRIMARY_DESTINATIONS = [
  { href: "/my", label: "Profile", icon: "person" },
  { href: "/my/circle", label: "My Circle", icon: "circle" },
  { href: "/my/practice", label: "The Work", icon: "book" },
  { href: "/my/library", label: "Library", icon: "library" },
  { href: "/my/experiences", label: "Calendar", icon: "calendar" },
] as const;

export function currentMemberPrimaryDestination(pathname: string): string | undefined {
  if (pathname === "/my/foundations" || pathname.startsWith("/my/foundations/")) return "/my/practice";
  if (pathname === "/my/learn" || pathname.startsWith("/my/learn/")) return "/my/library";
  if (pathname === "/my/card" || pathname === "/my/invitation" || pathname === "/my/badges" || pathname === "/my/timeline" || pathname.startsWith("/my/timeline/")) return "/my";
  return MEMBER_PRIMARY_DESTINATIONS.find(({ href }) => pathname === href || (href !== "/my" && pathname.startsWith(`${href}/`)))?.href;
}
