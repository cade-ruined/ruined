"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { CalendarGlyph } from "@/components/nav/CalendarGlyph";
import { CouchGlyph } from "@/components/nav/CouchGlyph";
import { PersonGlyph } from "@/components/nav/PersonGlyph";
import UniversalSearch from "@/components/search/UniversalSearch";
import BagLink from "@/components/store/BagLink";
import {
  EXPLORE_ROOMS,
  SITE_ROUTES,
  WALK_MENU_ITEMS,
  activeGlobalNavigationId,
  sectionLocatorForPathname,
  type ExploreRoom,
} from "@/data/navigation";
import { isMyRuinedVisible } from "@/lib/platform/visibility";
import { useBackgroundPathname } from "@/hooks/useBackgroundPathname";

const MENU_ID = "site-navigation-menu";

export default function SiteHeader() {
  const pathname = useBackgroundPathname();
  const menuTitleId = useId();
  const isLanding = pathname.startsWith("/lp");
  const isFoundations = pathname === "/foundations";
  const isPlatform =
    pathname.startsWith("/my") || pathname.startsWith("/ops") || pathname.startsWith("/auth");
  const isHome = pathname === "/";
  const isBag = pathname === SITE_ROUTES.bag.href;
  const usesDarkSurface =
    pathname.startsWith(SITE_ROUTES.store.href) ||
    isBag ||
    pathname.startsWith(`${SITE_ROUTES.work.href}/`);
  const showMyRuined = isMyRuinedVisible();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [headerSolid, setHeaderSolid] = useState(!isHome);
  const [homeSceneIndex, setHomeSceneIndex] = useState(0);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLElement>(null);
  const firstMenuItemRef = useRef<HTMLAnchorElement>(null);
  const restoreMenuFocusRef = useRef(true);
  const activeGlobalId = activeGlobalNavigationId(pathname);
  const sectionLocator = sectionLocatorForPathname(pathname);
  const visibleLocator = isHome
    ? EXPLORE_ROOMS[homeSceneIndex]?.label
    : sectionLocator;

  useEffect(() => {
    restoreMenuFocusRef.current = false;
    setMenuOpen(false);
    setSearchOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isHome) {
      setHeaderSolid(true);
      return;
    }

    let frame = 0;
    const syncHeader = (
      hash = window.location.hash || "#top",
      syncSceneFromHash = true
    ) => {
      setHeaderSolid(window.scrollY > 24 || hash !== "#top");
      if (!syncSceneFromHash) return;
      const sceneIndex = EXPLORE_ROOMS.findIndex((room) => room.hash === hash);
      if (sceneIndex >= 0) setHomeSceneIndex(sceneIndex);
    };
    const scheduleHeaderSolidSync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => syncHeader(undefined, false));
    };
    const scheduleLocationSync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => syncHeader());
    };
    const syncScene = (event: Event) => {
      const sceneEvent = event as CustomEvent<{ hash?: string; index?: number }>;
      if (typeof sceneEvent.detail?.index === "number") {
        setHomeSceneIndex(sceneEvent.detail.index);
      }
      syncHeader(sceneEvent.detail?.hash ?? window.location.hash ?? "#top");
    };

    syncHeader();
    window.addEventListener("scroll", scheduleHeaderSolidSync, { passive: true });
    window.addEventListener("hashchange", scheduleLocationSync);
    window.addEventListener("ruined:home-scene-change", syncScene);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleHeaderSolidSync);
      window.removeEventListener("hashchange", scheduleLocationSync);
      window.removeEventListener("ruined:home-scene-change", syncScene);
    };
  }, [isHome]);

  useEffect(() => {
    if (!menuOpen) return;
    const menuButton = menuButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() => {
      firstMenuItemRef.current?.focus({ preventScroll: true });
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      restoreMenuFocusRef.current = true;
      setMenuOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
      const shouldRestoreFocus = restoreMenuFocusRef.current;
      restoreMenuFocusRef.current = true;
      if (shouldRestoreFocus) {
        requestAnimationFrame(() => {
          menuButton?.focus({ preventScroll: true });
        });
      }
    };
  }, [menuOpen]);

  const closeMenu = () => {
    restoreMenuFocusRef.current = true;
    setMenuOpen(false);
  };
  const closeMenuForNavigation = () => {
    restoreMenuFocusRef.current = false;
    setMenuOpen(false);
  };
  const openSearch = () => {
    if (menuOpen) {
      restoreMenuFocusRef.current = false;
      setMenuOpen(false);
      requestAnimationFrame(() => setSearchOpen(true));
    } else {
      setSearchOpen(true);
    }
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab" || !menuPanelRef.current) return;
    const focusable = Array.from(
      menuPanelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleWalkLink = (
    event: ReactMouseEvent<HTMLAnchorElement>,
    room: ExploreRoom = EXPLORE_ROOMS[0]
  ) => {
    if (isHome) closeMenu();
    else closeMenuForNavigation();
    if (
      !isHome ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const request = new CustomEvent("ruined:home-scene-request", {
      cancelable: true,
      detail: { hash: room.hash, index: room.sceneIndex },
    });
    if (!window.dispatchEvent(request)) event.preventDefault();
  };

  if (isLanding || isFoundations || isPlatform) return null;

  const overlayOpen = menuOpen || searchOpen;

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-[70]">
        <nav
          aria-label="Primary"
          data-home={isHome ? "true" : "false"}
          data-solid={headerSolid || overlayOpen ? "true" : "false"}
          className="ruined-global-header pointer-events-auto relative z-20 text-[var(--color-bone)]"
        >
          <div className="ruined-header-rail">
            <div className="ruined-header-left">
              <button
                ref={menuButtonRef}
                data-contact-return-focus
                type="button"
                aria-expanded={menuOpen}
                aria-controls={MENU_ID}
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                className="ruined-header-control ruined-header-menu-trigger"
                onClick={() => {
                  setSearchOpen(false);
                  restoreMenuFocusRef.current = true;
                  setMenuOpen((open) => !open);
                }}
              >
                <MenuGlyph open={menuOpen} />
                <span className="ruined-header-control-label">
                  {menuOpen ? "Close" : "Menu"}
                </span>
              </button>
              {showMyRuined && <SearchControl open={searchOpen} onOpen={openSearch} />}
            </div>

            <BrandHomeLink isHome={isHome} onHomeClick={handleWalkLink} />

            <div className="ruined-header-utilities">
              {!showMyRuined && <SearchControl open={searchOpen} onOpen={openSearch} />}
              {showMyRuined && (
                <Link
                  href={SITE_ROUTES.my.href}
                  aria-label="My Ruined"
                  className="ruined-header-control ruined-header-person"
                >
                  <PersonGlyph className="ruined-person-glyph" />
                </Link>
              )}
              <BagLink
                variant="icon"
                current={isBag}
                className={`ruined-header-bag ${
                  isBag ? "text-[var(--color-primary)]" : "text-white/90"
                }`}
              />
            </div>
          </div>

          {visibleLocator && (
            <span
              data-section-breadcrumb
              aria-hidden="true"
              className="ruined-section-locator"
            >
              {visibleLocator}
            </span>
          )}
        </nav>

        {menuOpen && (
          <div className="ruined-site-menu-layer pointer-events-auto">
            <button
              type="button"
              tabIndex={-1}
              aria-label="Close menu"
              className="ruined-site-menu-backdrop"
              onClick={closeMenu}
            />
            <aside
              ref={menuPanelRef}
              id={MENU_ID}
              role="dialog"
              aria-modal="true"
              aria-labelledby={menuTitleId}
              className="ruined-site-menu-panel"
              onKeyDown={handleMenuKeyDown}
            >
              <h2 id={menuTitleId} className="sr-only">
                Site navigation
              </h2>
              <div className="ruined-site-menu-heading" aria-hidden="true">
                <span className="ruined-site-menu-kicker">THE INDEX</span>
                <span>RUINED / MMXXVI</span>
              </div>

              <div className="ruined-site-menu-content">
                <nav aria-label="Site destinations" className="ruined-site-menu-nav">
                  {WALK_MENU_ITEMS.map((item, index) => {
                    const active = isHome
                      ? homeSceneIndex === item.sceneIndex
                      : activeGlobalId === item.id;
                    return (
                      <Link
                        key={item.id}
                        ref={index === 0 ? firstMenuItemRef : undefined}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        onClick={(event) => handleWalkLink(event, item)}
                        className={active ? "is-active" : undefined}
                      >
                        <span className="ruined-site-menu-number" aria-hidden="true">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="ruined-site-menu-icon" aria-hidden="true">
                          <ExploreGlyph index={item.glyphIndex} />
                        </span>
                        <strong>{item.label}</strong>
                        <span className="ruined-site-menu-arrow" aria-hidden="true">
                          ↗
                        </span>
                      </Link>
                    );
                  })}
                </nav>

                <div className="ruined-site-menu-secondary">
                  <Link href={SITE_ROUTES.contact.href} onClick={closeMenuForNavigation}>
                    Contact
                  </Link>
                </div>
              </div>

              <div className="ruined-site-menu-footer" aria-hidden="true">
                <span>The Ruined Project</span>
                <span>Alpine / 40.4478° N</span>
              </div>
            </aside>
          </div>
        )}
      </header>

      <UniversalSearch open={searchOpen} onOpenChange={setSearchOpen} />

      {!isHome && (
        <div
          aria-hidden
          className={`${
            sectionLocator ? "h-[7.25rem] sm:h-[8rem]" : "h-16"
          } ${usesDarkSurface ? "bg-black" : "bg-[var(--color-bone)]"}`}
        />
      )}
    </>
  );
}

function BrandHomeLink({
  isHome,
  onHomeClick,
}: {
  isHome: boolean;
  onHomeClick: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <Link
      href="/#top"
      aria-label="Ruined — explore the walk"
      onClick={isHome ? onHomeClick : undefined}
      className="ruined-header-brand"
    >
      <Image
        src="/ruined-wordmark.svg"
        alt="RUINED"
        width={1000}
        height={300}
        priority
        draggable={false}
        className="ruined-header-wordmark"
      />
    </Link>
  );
}

function MenuGlyph({ open }: { open: boolean }) {
  return (
    <span aria-hidden="true" className={`ruined-menu-glyph ${open ? "is-open" : ""}`}>
      <span />
      <span />
    </span>
  );
}

function SearchGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="ruined-search-glyph"
      fill="none"
    >
      <circle cx="10.5" cy="10.5" r="6.25" />
      <path d="m15.25 15.25 4.5 4.5" />
    </svg>
  );
}

function SearchControl({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label="Search Ruined"
      className="ruined-header-control ruined-header-search-trigger"
      onClick={onOpen}
    >
      <SearchGlyph />
    </button>
  );
}

function ExploreGlyph({
  index,
  className = "h-7 w-8 shrink-0",
}: {
  index: number;
  className?: string;
}) {
  if (index < 4) return <CouchGlyph index={index} className={className} />;
  return <CalendarGlyph className={className} />;
}
