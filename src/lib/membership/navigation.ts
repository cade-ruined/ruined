export const MEMBER_DESTINATIONS = [
  { href: "/my", label: "Profile", group: "Your record", keywords: "home journal writing saved entries achievements history attended milestones badges bio" },
  { href: "/my/card", label: "My Card", group: "Your record", keywords: "public share flip portrait card download identity" },
  { href: "/my/invitation", label: "My Invitation", group: "Your record", keywords: "invite invitation referral people joined share" },
  { href: "/my/foundations/timeline", label: "My Timeline", group: "Your record", keywords: "life story journey export carousel" },
  { href: "/my/artifacts", label: "Artifacts", group: "Your record", keywords: "awards earned coin collection fulfillment tracking" },
  { href: "/my/circle", label: "Circle", group: "Your membership", keywords: "people shaper chat google meet group" },
  { href: "/my/experiences", label: "Experiences", group: "Your membership", keywords: "events calendar meetings rsvp attend" },
  { href: "/my/foundations", label: "Foundations", group: "Your membership", keywords: "start progress course reflection" },
  { href: "/my/learn", label: "Academy", group: "Your membership", keywords: "learn training videos library lessons courses" },
  { href: "/my/updates", label: "Updates", group: "Your membership", keywords: "notifications announcements unread messages inbox" },
  { href: "/my/profile", label: "Edit profile", group: "Your account", keywords: "photo portrait name bio privacy visibility location timezone" },
  { href: "/my/account", label: "Account", group: "Your account", keywords: "membership billing payment subscription agreement settings" },
  { href: "/my/support", label: "Support", group: "Your account", keywords: "help contact connect ticket shipping address change phone" },
] as const;

export function currentMemberDestination(pathname: string): string | undefined {
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
  { href: "/my/foundations", label: "Foundations", icon: "book" },
  { href: "/my/experiences", label: "Events", icon: "calendar" },
] as const;

export function currentMemberPrimaryDestination(pathname: string): string | undefined {
  if (pathname === "/my/card" || pathname === "/my/invitation") return "/my";
  if (pathname === "/my/foundations/timeline" || pathname.startsWith("/my/foundations/timeline/")) return "/my";
  return MEMBER_PRIMARY_DESTINATIONS.find(({ href }) => pathname === href || (href !== "/my" && pathname.startsWith(`${href}/`)))?.href;
}
