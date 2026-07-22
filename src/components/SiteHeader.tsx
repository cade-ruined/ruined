"use client";

import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  const isHome = pathname === "/";
  const [currentHash, setCurrentHash] = useState("#top");

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

  if (isLanding) return null;

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-[60] px-3 pt-3 sm:px-5 sm:pt-4">
        <nav
          aria-label="Primary"
          className="pointer-events-auto relative z-10 flex h-14 w-fit items-center border border-white/15 bg-black/90 px-3 text-[var(--color-bone)] shadow-[0_8px_32px_rgba(0,0,0,0.28)] sm:h-16 sm:px-4 md:mx-auto md:w-full md:max-w-5xl md:justify-between md:bg-black/75 md:backdrop-blur-md"
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

          <div className="hidden h-full items-stretch md:flex">
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

        <nav
          aria-label="Quick jump"
          className="pointer-events-auto fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] z-20 grid grid-cols-5 border border-white/15 bg-black/92 p-1 text-[var(--color-bone)] shadow-[0_10px_32px_rgba(0,0,0,0.4)] backdrop-blur-md md:hidden"
        >
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
                className={`group relative flex min-w-0 flex-col items-center justify-center gap-0.5 border-r border-white/10 px-0.5 py-1.5 transition-colors last:border-r-0 ${
                  active
                    ? "bg-white/5 text-[var(--color-primary)]"
                    : "text-white/75 active:bg-white/10 active:text-white"
                }`}
              >
                <span
                  aria-hidden
                  className="flex h-7 items-center justify-center"
                >
                  <HeaderGlyph index={item.index} />
                </span>
                <span className="ui-heading truncate text-[0.42rem] uppercase tracking-[0.08em] text-current">
                  {item.label}
                </span>
                {active && (
                  <span
                    aria-hidden
                    className="absolute right-1 top-1 h-1 w-1 rounded-full bg-[var(--color-primary)] shadow-[0_0_8px_rgba(208,49,45,0.9)]"
                  />
                )}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* Inner pages begin below the persistent header. The immersive homepage
          intentionally runs behind it so the opening frame remains full-bleed. */}
      {!isHome && <div aria-hidden className="h-[4.75rem] sm:h-[5.5rem]" />}
    </>
  );
}

function HeaderGlyph({ index }: { index: number }) {
  if (index < 4) return <CouchGlyph index={index} className="h-6 w-7 shrink-0" />;
  return <span aria-hidden className="flex h-6 w-7 shrink-0 items-center justify-center text-[1.15rem] leading-none">✦</span>;
}
