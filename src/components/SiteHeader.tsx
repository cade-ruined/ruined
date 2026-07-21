"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CouchGlyph } from "@/components/nav/CouchGlyph";

const NAV_ITEMS = [
  { label: "Home", href: "/#top", hash: "#top", index: 0 },
  { label: "Store", href: "/#store", hash: "#store", index: 1 },
  { label: "Work", href: "/#work", hash: "#work", index: 2 },
  { label: "About", href: "/#about", hash: "#about", index: 3 },
] as const;

function isActive(pathname: string, currentHash: string, itemHash: string) {
  if (pathname !== "/") return false;
  return currentHash === itemHash;
}

export default function SiteHeader() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [currentHash, setCurrentHash] = useState("#top");

  useEffect(() => {
    const syncHash = () => setCurrentHash(window.location.hash || "#top");
    syncHash();
    window.addEventListener("hashchange", syncHash);
    window.addEventListener("popstate", syncHash);
    return () => {
      window.removeEventListener("hashchange", syncHash);
      window.removeEventListener("popstate", syncHash);
    };
  }, [pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-[60] px-3 pt-3 sm:px-5 sm:pt-4">
        {mobileOpen && (
          <button
            type="button"
            aria-label="Close navigation"
            className="pointer-events-auto fixed inset-0 z-0 bg-black/25 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}
        <nav
          aria-label="Primary"
          className="pointer-events-auto relative z-10 mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 border border-white/15 bg-black/75 px-3 text-[var(--color-bone)] shadow-[0_8px_32px_rgba(0,0,0,0.28)] backdrop-blur-md sm:h-16 sm:px-4"
        >
          <Link
            href="/"
            aria-label="Ruined — home"
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
                  onClick={() => setCurrentHash(item.hash)}
                  className={`ui-heading group relative flex min-w-[5.75rem] items-center justify-center gap-2 px-3 text-[0.58rem] uppercase tracking-[0.14em] transition-colors ${
                    active
                      ? "text-[var(--color-primary)]"
                      : "text-white/75 hover:text-white"
                  }`}
                >
                  <CouchGlyph index={item.index} className="h-6 w-7 shrink-0" />
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

          <button
            type="button"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-primary-navigation"
            onClick={() => setMobileOpen((open) => !open)}
            className="ui-heading flex h-11 min-w-11 items-center justify-center gap-2 px-2 text-[0.58rem] uppercase tracking-[0.14em] text-white md:hidden"
          >
            <span className="hidden min-[360px]:inline">{mobileOpen ? "Close" : "Menu"}</span>
            <span aria-hidden className="relative block h-4 w-5">
              <span
                className={`absolute left-0 top-[4px] h-px w-5 bg-current transition-transform duration-200 ${
                  mobileOpen ? "translate-y-[4px] rotate-45" : ""
                }`}
              />
              <span
                className={`absolute left-0 top-[12px] h-px w-5 bg-current transition-transform duration-200 ${
                  mobileOpen ? "-translate-y-[4px] -rotate-45" : ""
                }`}
              />
            </span>
          </button>
        </nav>

        {mobileOpen && (
          <div
            id="mobile-primary-navigation"
            className="pointer-events-auto relative z-10 mx-auto mt-2 grid max-w-5xl grid-cols-2 border border-white/15 bg-black/90 p-2 text-[var(--color-bone)] shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur-xl md:hidden"
          >
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, currentHash, item.hash);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => {
                    setCurrentHash(item.hash);
                    setMobileOpen(false);
                  }}
                  className={`ui-heading relative flex min-h-20 items-center gap-4 border border-white/10 px-4 text-[0.68rem] uppercase tracking-[0.14em] transition-colors ${
                    active
                      ? "bg-white/5 text-[var(--color-primary)]"
                      : "text-white/80 active:bg-white/10 active:text-white"
                  }`}
                >
                  <CouchGlyph index={item.index} className="h-8 w-9 shrink-0" />
                  <span>{item.label}</span>
                  {active && (
                    <span
                      aria-hidden
                      className="absolute bottom-2 left-4 h-1 w-1 rounded-full bg-[var(--color-primary)] shadow-[0_0_8px_rgba(208,49,45,0.9)]"
                    />
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </header>

      {/* Inner pages begin below the persistent header. The immersive homepage
          intentionally runs behind it so the opening frame remains full-bleed. */}
      {!isHome && <div aria-hidden className="h-[4.75rem] sm:h-[5.5rem]" />}
    </>
  );
}
