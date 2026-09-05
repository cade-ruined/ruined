"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

const MEMBER_DESTINATIONS = [
  { href: "/my", label: "Profile" },
  { href: "/my/foundations", label: "Foundations" },
  { href: "/my/foundations/timeline", label: "Ruined Timeline" },
  { href: "/my/circle", label: "Circle" },
  { href: "/my/experiences", label: "Experiences" },
  { href: "/my/learn", label: "Learn" },
  { href: "/my/artifacts", label: "Artifacts" },
  { href: "/my/updates", label: "Updates" },
  { href: "/my/profile", label: "Edit profile" },
  { href: "/my/account", label: "Account" },
  { href: "/my/support", label: "Support" },
] as const;

function isCurrentPath(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/my") return false;
  return pathname.startsWith(`${href}/`);
}

export default function MemberNavigationFab() {
  const pathname = usePathname();
  const currentHref = [...MEMBER_DESTINATIONS]
    .filter((destination) => isCurrentPath(pathname, destination.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const frame = requestAnimationFrame(() => {
      const currentLink = rootRef.current?.querySelector<HTMLAnchorElement>(
        'a[aria-current="page"]'
      );
      (currentLink ?? firstLinkRef.current)?.focus({ preventScroll: true });
    });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus({ preventScroll: true }));
    };
    const closeOutside = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOutside);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOutside);
    };
  }, [open]);

  return (
    <div
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] right-4 z-[65] flex flex-col items-end gap-3 sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:right-6"
      ref={rootRef}
    >
      {open ? (
        <nav
          aria-label="Membership"
          className="max-h-[min(40rem,calc(100dvh-7rem-env(safe-area-inset-bottom,0px)))] w-[min(21rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain border border-white/15 bg-[#080605] p-2 text-[var(--color-bone)] shadow-[0_24px_70px_rgba(0,0,0,0.34)]"
          id={menuId}
        >
          <div className="flex items-center justify-between border-b border-white/15 px-4 py-3">
            <span className="font-[var(--font-body)] text-[0.65rem] font-medium uppercase tracking-[0.18em] text-white/55">
              Ruined Membership
            </span>
            <span className="font-[var(--font-handwritten)] text-lg leading-none text-[var(--color-poster)]">
              enter here
            </span>
          </div>
          <ol className="py-1">
            {MEMBER_DESTINATIONS.map((destination, index) => {
              const current = destination.href === currentHref;
              return (
                <li key={destination.href}>
                  <Link
                    aria-current={current ? "page" : undefined}
                    className={`group grid min-h-12 grid-cols-[2rem_1fr_auto] items-center gap-3 px-4 py-3 font-[var(--font-body)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-poster)] ${
                      current
                        ? "bg-[var(--color-bone)] text-[#171411]"
                        : "text-white/72 hover:bg-white/[0.06] hover:text-white"
                    }`}
                    href={destination.href}
                    ref={index === 0 ? firstLinkRef : undefined}
                  >
                    <span className="text-[0.6rem] tracking-[0.12em] opacity-45">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="text-base tracking-[-0.015em]">{destination.label}</span>
                    <span aria-hidden="true" className="text-sm opacity-45 transition-transform group-hover:translate-x-0.5">
                      →
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
      ) : null}

      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-label={open ? "Close membership navigation" : "Open membership navigation"}
        className="group grid size-[4.25rem] place-items-center border border-white/15 bg-[#080605] text-[var(--color-bone)] shadow-[0_14px_38px_rgba(0,0,0,0.28)] transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)] motion-reduce:transition-none sm:size-[4.75rem]"
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        {open ? (
          <span aria-hidden="true" className="relative block size-6">
            <span className="absolute left-1/2 top-1/2 h-px w-6 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-current" />
            <span className="absolute left-1/2 top-1/2 h-px w-6 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-current" />
          </span>
        ) : (
          <Image
            alt=""
            aria-hidden="true"
            className="size-11 transition-transform duration-300 group-hover:scale-[1.04] motion-reduce:transition-none sm:size-12"
            height={48}
            priority
            src="/favicon-ruined-mark-v2.svg"
            width={48}
          />
        )}
      </button>
    </div>
  );
}
