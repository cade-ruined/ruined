export const SITE_ROUTES = {
  home: { id: "home", label: "Explore the Walk", href: "/", glyphIndex: 0 },
  store: { id: "store", label: "Store", href: "/store", glyphIndex: 1 },
  work: { id: "work", label: "Artifacts", href: "/work", glyphIndex: 2 },
  about: { id: "about", label: "About", href: "/about", glyphIndex: 3 },
  events: { id: "events", label: "Community", href: "/community", glyphIndex: 4 },
  contact: { id: "contact", label: "Contact", href: "/contact" },
  my: { id: "my", label: "My Ruined", href: "/my" },
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
  SITE_ROUTES.work,
  SITE_ROUTES.about,
  SITE_ROUTES.events,
] as const;

export const GLOBAL_MENU_ITEMS = [SITE_ROUTES.home, ...GLOBAL_NAV_ITEMS] as const;

export const SERVICE_NAV_ITEMS = [
  SITE_ROUTES.privacy,
] as const;

export const EXPLORE_ROOM_IDS = [
  "top",
  "store",
  "work",
  "about",
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
    id: "work",
    label: "Artifacts",
    locator: "ARTIFACTS",
    headline: "Artifacts.",
    description: "Coming soon.",
    href: "/#work",
    hash: "#work",
    sceneIndex: 2,
    glyphIndex: SITE_ROUTES.work.glyphIndex,
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
    sceneIndex: 3,
    glyphIndex: SITE_ROUTES.about.glyphIndex,
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

// The primary menu currently returns visitors to the immersive walk. Keep this
// separate from SITE_ROUTES so the standalone pages can come back without
// rebuilding the navigation system.
export const WALK_MENU_ITEMS = EXPLORE_ROOMS;

// Launch-facing section links stay inside the immersive walk while the
// conventional routes remain available for a later, populated release.
export const WALK_SECTION_ITEMS = EXPLORE_ROOMS.slice(1);

export const FOOTER_INDEX_ITEMS = [
  ...WALK_SECTION_ITEMS,
  SITE_ROUTES.contact,
] as const;

export type GlobalNavId = (typeof GLOBAL_NAV_ITEMS)[number]["id"];
export type ExploreHash = (typeof EXPLORE_ROOMS)[number]["hash"];
export type ExploreRoom = (typeof EXPLORE_ROOMS)[number];

const SECTION_LOCATORS: Record<GlobalNavId | "bag", string> = {
  store: "THE STORE",
  work: "ARTIFACTS",
  about: "ABOUT",
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
  if (pathname === SITE_ROUTES.bag.href) return SECTION_LOCATORS.bag;
  const activeId = activeGlobalNavigationId(pathname);
  return activeId ? SECTION_LOCATORS[activeId] : undefined;
}
