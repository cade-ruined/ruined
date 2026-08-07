"use client";

import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarGlyph } from "@/components/nav/CalendarGlyph";
import { CouchGlyph } from "@/components/nav/CouchGlyph";

const NAV_ITEMS = [
  { label: "Home", href: "/#top", hash: "#top", index: 0 },
  { label: "Store", href: "/#store", hash: "#store", index: 1 },
  { label: "Work", href: "/#work", hash: "#work", index: 2 },
  { label: "About", href: "/#about", hash: "#about", index: 3 },
  { label: "Events", href: "/#events", hash: "#events", index: 4 },
] as const;

function isActive(pathname: string, currentHash: string, itemHash: string) {
  if (pathname === "/") return currentHash === itemHash;
  if (pathname.startsWith("/store")) return itemHash === "#store";
  if (pathname.startsWith("/work")) return itemHash === "#work";
  if (pathname.startsWith("/about")) return itemHash === "#about";
  if (pathname.startsWith("/events")) return itemHash === "#events";
  return false;
}

export default function SiteHeader() {
  const pathname = usePathname();
  const isLanding = pathname.startsWith("/lp");
  const isFoundations = pathname === "/foundations";
  const isHome = pathname === "/";
  const [currentHash, setCurrentHash] = useState("#top");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const syncHash = () => setCurrentHash(window.location.hash || "#top");
    const syncMobileScene = (event: Event) => {
      const sceneEvent = event as CustomEvent<{ hash?: string }>;
      setCurrentHash(sceneEvent.detail?.hash ?? window.location.hash ?? "#top");
    };
    syncHash();
    window.addEventListener("hashchange", syncHash);
    window.addEventListener("popstate", syncHash);
    window.addEventListener("ruined:home-scene-change", syncMobileScene);
    return () => {
      window.removeEventListener("hashchange", syncHash);
      window.removeEventListener("popstate", syncHash);
      window.removeEventListener("ruined:home-scene-change", syncMobileScene);
    };
  }, [pathname]);

  // Keep the highlighted icon synchronized with the scene currently crossing
  // the middle of the viewport. The invisible journey anchors are repositioned
  // after the frame manifest loads, so their live document positions are read
  // on every scheduled update rather than cached on mount.
  useEffect(() => {
    if (!isHome) return;
    let raf = 0;
    const syncSection = () => {
      raf = 0;
      const mobileStage = document.querySelector<HTMLElement>(
        "[data-mobile-stage]"
      );
      if (mobileStage?.dataset.activeScene) {
        setCurrentHash(`#${mobileStage.dataset.activeScene}`);
        return;
      }
      const probe = window.scrollY + window.innerHeight * 0.5;
      let active = "#top";
      for (const item of NAV_ITEMS.slice(1)) {
        const anchor = document.getElementById(item.hash.slice(1));
        if (!anchor) continue;
        const anchorY = anchor.getBoundingClientRect().top + window.scrollY;
        if (probe >= anchorY) active = item.hash;
      }
      setCurrentHash(active);
    };
    const scheduleSync = () => {
      if (!raf) raf = requestAnimationFrame(syncSection);
    };
    syncSection();
    window.addEventListener("scroll", scheduleSync, { passive: true });
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("ruined:home-anchors-ready", scheduleSync);
    window.addEventListener("ruined:home-scene-change", scheduleSync);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", scheduleSync);
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("ruined:home-anchors-ready", scheduleSync);
      window.removeEventListener("ruined:home-scene-change", scheduleSync);
    };
  }, [isHome]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [currentHash, pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMobileMenuOpen(false);
      requestAnimationFrame(() => {
        mobileMenuButtonRef.current?.focus({ preventScroll: true });
      });
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileMenuOpen]);

  const handleHomeSceneClick = (
    event: ReactMouseEvent<HTMLAnchorElement>,
    hash: string,
    index: number
  ) => {
    if (
      !isHome ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      setCurrentHash(hash);
      return;
    }

    const request = new CustomEvent("ruined:home-scene-request", {
      cancelable: true,
      detail: { hash, index },
    });
    if (!window.dispatchEvent(request)) {
      event.preventDefault();
      return;
    }
    setCurrentHash(hash);
  };

  const handleMobileSceneClick = (
    event: ReactMouseEvent<HTMLAnchorElement>,
    hash: string,
    index: number
  ) => {
    const restoreFocus = event.detail === 0;
    setMobileMenuOpen(false);
    handleHomeSceneClick(event, hash, index);
    if (restoreFocus) {
      requestAnimationFrame(() => {
        mobileMenuButtonRef.current?.focus({ preventScroll: true });
      });
    }
  };

  const activeMobileItem =
    NAV_ITEMS.find((item) => isActive(pathname, currentHash, item.hash)) ??
    NAV_ITEMS[0];

  if (isLanding || isFoundations) return null;

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-[60] px-3 pt-3 sm:px-5 sm:pt-4">
        <nav
          aria-label="Primary"
          className="ruined-header-shell pointer-events-auto relative z-10 flex h-14 w-fit items-center border border-white/15 bg-black/90 px-3 text-[var(--color-bone)] shadow-[0_8px_32px_rgba(0,0,0,0.28)] sm:h-16 sm:px-4 md:mx-auto md:w-full md:max-w-5xl md:justify-between md:bg-black/75 md:backdrop-blur-md"
        >
          <Link
            href="/"
            aria-label="Ruined — home"
            onClick={(event) => handleHomeSceneClick(event, "#top", 0)}
            className="shrink-0 px-1 opacity-90 transition-opacity hover:opacity-100"
          >
            <Image
              src="/ruined-wordmark.svg"
              alt="RUINED"
              width={1000}
              height={206}
              priority
              draggable={false}
              className="h-5 w-auto select-none sm:h-6"
            />
          </Link>

          <div className="ruined-header-desktop-nav hidden h-full items-stretch md:flex">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, currentHash, item.hash);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  onClick={(event) =>
                    handleHomeSceneClick(event, item.hash, item.index)
                  }
                  className={`ui-heading group relative flex min-w-[5.75rem] items-center justify-center gap-2 px-3 text-[0.58rem] uppercase tracking-[0.14em] transition-colors ${
                    active
                      ? "text-[var(--color-primary)]"
                      : "text-white/75 hover:text-white"
                  }`}
                >
                  <HeaderGlyph index={item.index} />
                  <span>{item.label}</span>
                  <span
                    aria-hidden
                    className={`absolute inset-x-2 bottom-0 h-px transition-opacity ${
                      active ? "bg-[var(--color-primary)] opacity-100" : "bg-white opacity-0 group-hover:opacity-40"
                    }`}
                  />
                </Link>
              );
            })}
          </div>
        </nav>

        <div
          className="ruined-header-mobile-fab pointer-events-auto fixed z-20 md:hidden"
          style={{
            right: "max(0.75rem, env(safe-area-inset-right, 0px))",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)",
          }}
        >
          {mobileMenuOpen && (
            <div
              aria-hidden="true"
              className="fixed inset-0 z-0 cursor-default bg-black/10 backdrop-blur-[1px]"
              onPointerDown={() => {
                setMobileMenuOpen(false);
                mobileMenuButtonRef.current?.focus({ preventScroll: true });
              }}
            />
          )}
          <nav
            id="mobile-quick-jump"
            aria-label="Quick jump"
            hidden={!mobileMenuOpen}
            className="absolute bottom-[calc(100%+0.625rem)] right-0 z-10 max-h-[min(26rem,calc(100svh-7rem))] w-[min(15rem,calc(100vw-1.5rem))] overflow-y-auto border border-white/15 bg-black/94 p-1 text-[var(--color-bone)] shadow-[0_16px_44px_rgba(0,0,0,0.55)] backdrop-blur-md"
          >
                {NAV_ITEMS.map((item) => {
                  const active = isActive(pathname, currentHash, item.hash);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-label={item.label}
                      aria-current={active ? "location" : undefined}
                      onClick={(event) =>
                        handleMobileSceneClick(event, item.hash, item.index)
                      }
                      className={`group relative flex min-h-12 items-center gap-3 border-b border-white/10 px-3 py-2 transition-colors last:border-b-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)] ${
                        active
                          ? "bg-white/[0.06] text-[var(--color-primary)]"
                          : "text-white/75 hover:bg-white/[0.04] hover:text-white active:bg-white/10"
                      }`}
                    >
                      <span
                        aria-hidden
                        className="flex h-7 w-8 shrink-0 items-center justify-center"
                      >
                        <HeaderGlyph index={item.index} />
                      </span>
                      <span className="ui-heading text-[0.58rem] uppercase tracking-[0.16em] text-current">
                        {item.label}
                      </span>
                      <span
                        aria-hidden
                        className={`ml-auto h-1.5 w-1.5 rounded-full ${
                          active
                            ? "bg-[var(--color-primary)] shadow-[0_0_8px_rgba(208,49,45,0.9)]"
                            : "bg-white/15"
                        }`}
                      />
                    </Link>
                  );
                })}
          </nav>

          <button
            ref={mobileMenuButtonRef}
            type="button"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-quick-jump"
            aria-label={
              mobileMenuOpen
                ? "Close navigation"
                : `Open navigation — ${activeMobileItem.label} selected`
            }
            onClick={() => setMobileMenuOpen((open) => !open)}
            className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-black/94 text-[var(--color-bone)] shadow-[0_10px_32px_rgba(0,0,0,0.5)] backdrop-blur-md transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
          >
            <span aria-hidden className={mobileMenuOpen ? "opacity-45" : ""}>
              <HeaderGlyph index={activeMobileItem.index} />
            </span>
            <span
              aria-hidden
              className={`absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-primary)] font-mono text-sm leading-none text-white shadow-[0_0_10px_rgba(208,49,45,0.65)] transition-transform ${
                mobileMenuOpen ? "rotate-45" : "rotate-0"
              }`}
            >
              +
            </span>
          </button>
        </div>
      </header>

      {/* Inner pages begin below the persistent header. The immersive homepage
          intentionally runs behind it so the opening frame remains full-bleed. */}
      {!isHome && <div aria-hidden className="h-[4.75rem] sm:h-[5.5rem]" />}
    </>
  );
}

function HeaderGlyph({ index }: { index: number }) {
  if (index < 4) return <CouchGlyph index={index} className="h-6 w-7 shrink-0" />;
  return <CalendarGlyph className="h-6 w-7 shrink-0" />;
}
