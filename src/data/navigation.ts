export const SITE_ROUTES = {
  home: { id: "home", label: "Explore the Walk", href: "/", glyphIndex: 0 },
  store: { id: "store", label: "Store", href: "/store", glyphIndex: 1 },
  work: { id: "work", label: "Artifacts", href: "/work", glyphIndex: 2 },
  about: { id: "about", label: "About", href: "/about", glyphIndex: 2 },
  members: { id: "members", label: "Members", href: "/members", glyphIndex: 3 },
  events: { id: "events", label: "Community", href: "/community", glyphIndex: 4 },
  contact: { id: "contact", label: "Contact", href: "/contact" },
  my: { id: "my", label: "Membership", href: "/my" },
  bag: { id: "bag", label: "Bag", href: "/bag" },
  shippingReturns: {
    id: "shipping-returns",
    label: "Shipping + Returns",
    href: "/shipping-returns",
  },
  terms: { id: "terms", label: "Terms", href: "/terms" },
  privacy: { id: "privacy", label: "Privacy", href: "/privacy" },
} as const;

export const GLOBAL_NAV_ITEMS = [
  SITE_ROUTES.store,
  SITE_ROUTES.about,
  SITE_ROUTES.members,
  SITE_ROUTES.events,
] as const;

// The walk is an experience; the primary menu is a shortcut to destinations.
export const GLOBAL_MENU_ITEMS = [
  { ...SITE_ROUTES.home, label: "Lobby", href: "/#top" },
  ...GLOBAL_NAV_ITEMS,
] as const;

export const SERVICE_NAV_ITEMS = [
  SITE_ROUTES.privacy,
] as const;

export const EXPLORE_ROOM_IDS = [
  "top",
  "store",
  "about",
  "members",
  "events",
] as const;

export const EXPLORE_ROOMS = [
  {
    id: "top",
    label: "Lobby",
    locator: "THE RUINED PROJECT",
    headline: "Explore Ruined.",
    description: "Objects, garments, spaces, and projects after the fear.",
    href: "/#top",
    hash: "#top",
    sceneIndex: 0,
    glyphIndex: SITE_ROUTES.home.glyphIndex,
  },
  {
    id: "store",
    label: "Store",
    locator: "THE STORE",
    headline: "The catalog.",
    description:
      "Objects for weather, work, and the rooms between. Numbered, materially documented, and released in small runs.",
    href: "/#store",
    hash: "#store",
    sceneIndex: 1,
    glyphIndex: SITE_ROUTES.store.glyphIndex,
  },
  {
    id: "about",
    label: "About",
    locator: "ABOUT RUINED",
    headline: "A studio for what survives.",
    description:
      "Objects, garments, spaces, and visual systems beginning with what has already been used, marked, or left unfinished.",
    href: "/#about",
    hash: "#about",
    sceneIndex: 2,
    glyphIndex: SITE_ROUTES.about.glyphIndex,
  },
  {
    id: "members",
    label: "Members",
    locator: "MEMBERS",
    headline: "A place to begin.",
    description: "Foundations, Circles, and a shared practice.",
    href: "/#members",
    hash: "#members",
    sceneIndex: 3,
    glyphIndex: SITE_ROUTES.members.glyphIndex,
  },
  {
    id: "events",
    label: "Community",
    locator: "COMMUNITY",
    headline: "Come together.",
    description: "Gatherings from The Ruined Project.",
    href: "/#events",
    hash: "#events",
    sceneIndex: 4,
    glyphIndex: SITE_ROUTES.events.glyphIndex,
  },
] as const;

// Room controls keep their in-walk anchors, separate from primary navigation.
export const WALK_MENU_ITEMS = EXPLORE_ROOMS;

// Launch-facing section links stay inside the immersive walk while the
// conventional routes remain available for a later, populated release.
export const WALK_SECTION_ITEMS = EXPLORE_ROOMS.slice(1);

export const FOOTER_INDEX_ITEMS = [
  ...GLOBAL_NAV_ITEMS,
  SITE_ROUTES.contact,
] as const;

export type GlobalNavId = (typeof GLOBAL_NAV_ITEMS)[number]["id"];
export type ExploreHash = (typeof EXPLORE_ROOMS)[number]["hash"];
export type ExploreRoom = (typeof EXPLORE_ROOMS)[number];

const SECTION_LOCATORS: Record<GlobalNavId | "work" | "bag", string> = {
  store: "THE STORE",
  work: "ARTIFACTS",
  about: "ABOUT",
  members: "MEMBERS",
  events: "COMMUNITY",
  bag: "THE BAG",
};

export function activeGlobalNavigationId(pathname: string): GlobalNavId | null {
  const active = GLOBAL_NAV_ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  );
  return active?.id ?? null;
}

export function sectionLocatorForPathname(pathname: string) {
  if (pathname === "/my" || pathname.startsWith("/my/")) return "MEMBERS";
  if (pathname === SITE_ROUTES.bag.href) return SECTION_LOCATORS.bag;
  if (pathname === SITE_ROUTES.work.href || pathname.startsWith(`${SITE_ROUTES.work.href}/`)) {
    return SECTION_LOCATORS.work;
  }
  const activeId = activeGlobalNavigationId(pathname);
  return activeId ? SECTION_LOCATORS[activeId] : undefined;
}
