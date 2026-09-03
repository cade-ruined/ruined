"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import MemberNavigationFab from "@/components/platform/MemberNavigationFab";
import { keepFocusInside } from "@/lib/accessibility/focus";
import type { PlatformConfiguration } from "@/lib/platform/config";

type PlatformSurface = "member" | "ops";

type OperatorNavigationRole = "circle_leader" | "guide" | "ops_admin";

type OperationsNavigationGroup = {
  adminOnly: boolean;
  items: Array<{ href: string; label: string }>;
  label: string;
};

const OPERATIONS_NAVIGATION: OperationsNavigationGroup[] = [
  {
    adminOnly: false,
    label: "Daily work",
    items: [
      { href: "/ops", label: "Overview" },
      { href: "/ops/members", label: "Members" },
      { href: "/ops/circles", label: "Circles" },
      { href: "/ops/foundations", label: "Foundations" },
      { href: "/ops/experiences", label: "Experiences" },
      { href: "/ops/work", label: "Work" },
    ],
  },
  {
    adminOnly: true,
    label: "Manage",
    items: [
      { href: "/ops/support", label: "Support" },
      { href: "/ops/academy", label: "Academy" },
      { href: "/ops/blocks", label: "Blocks" },
      { href: "/ops/artifacts", label: "Artifacts" },
      { href: "/ops/announcements", label: "Announcements" },
      { href: "/ops/notifications", label: "Notifications" },
    ],
  },
  {
    adminOnly: true,
    label: "Administration",
    items: [
      { href: "/ops/operators", label: "Operators" },
      { href: "/ops/system", label: "System" },
    ],
  },
];

function isCurrentPath(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/ops") return false;
  return pathname.startsWith(`${href}/`);
}

function ConnectionMark({
  label,
  state,
}: {
  label: string;
  state: "connected" | "disconnected";
}) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span
        aria-hidden="true"
        className={`size-1.5 ${state === "connected" ? "bg-[var(--color-verdigris)]" : "bg-white/25"}`}
      />
      {label} {state === "connected" ? "on" : "off"}
    </span>
  );
}

function PlatformUtilityRail({
  configuration,
  dark,
  hideBrand,
  operatorRole,
  surface,
  viewerLabel,
}: {
  configuration: PlatformConfiguration;
  dark: boolean;
  hideBrand?: boolean;
  operatorRole?: OperatorNavigationRole | null;
  surface: PlatformSurface;
  viewerLabel?: string | null;
}) {
  const preview = configuration.mode === "preview";

  return (
    <div
      className={`font-[var(--font-body)] ${
        dark ? "text-white" : "text-[#201d19]"
      }`}
    >
      <div className={`mx-auto flex max-w-[96rem] flex-wrap items-center gap-x-8 gap-y-2 px-4 sm:px-6 lg:px-10 ${hideBrand ? "min-h-11 justify-end py-0" : "min-h-14 justify-between py-3"}`}>
        {!hideBrand ? (
          <p className="text-[0.66rem] font-medium uppercase tracking-[0.18em] opacity-70">
            {surface === "member" ? "Ruined Membership" : "Ruined Operations"}
          </p>
        ) : null}

        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[0.7rem] uppercase tracking-[0.1em]">
          <span
            className={
              preview
                ? `inline-flex items-center gap-2 before:size-1.5 before:bg-[var(--color-poster)] ${
                    dark ? "text-white/70" : "text-current opacity-70"
                  }`
                : configuration.mode === "connected"
                  ? dark
                    ? "opacity-50"
                    : "opacity-65"
                  : "inline-flex items-center gap-2 text-current opacity-70 before:size-1.5 before:bg-[var(--color-poster)]"
            }
          >
            {preview
              ? "Preview"
              : configuration.mode === "connected"
                ? surface === "member"
                  ? "Member access"
                  : "Operator access"
                : "Unavailable"}
          </span>
          {viewerLabel ? (
            <span className="hidden max-w-56 truncate border-l border-current/20 pl-3 normal-case tracking-[-0.01em] opacity-55 sm:inline">
              {viewerLabel}
            </span>
          ) : null}
          {surface === "member" && viewerLabel ? (
            <Link
              className="inline-flex min-h-11 items-center border-l border-current/20 pl-3 font-medium normal-case tracking-[-0.01em] opacity-65 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)]"
              href="/my/support"
            >
              Support
            </Link>
          ) : null}
          {operatorRole ? (
            <Link
              className="inline-flex min-h-11 items-center border-l border-current/20 pl-3 font-medium normal-case tracking-[-0.01em] opacity-65 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)]"
              href="/ops"
            >
              Operations →
            </Link>
          ) : null}
          {viewerLabel && !preview ? (
            <form
              action="/api/auth/sign-out?next=/access"
              className="border-l border-current/20 pl-3"
              method="post"
            >
              <button
                className="inline-flex min-h-11 items-center uppercase tracking-[0.12em] opacity-65 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)]"
                type="submit"
              >
                Sign out
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OperationsNavigation({
  configuration,
  operatorRole,
  pathname,
  viewerLabel,
}: {
  configuration: PlatformConfiguration;
  operatorRole?: OperatorNavigationRole | null;
  pathname: string;
  viewerLabel?: string | null;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopMenu, setDesktopMenu] = useState<string | null>(null);
  const desktopHeaderRef = useRef<HTMLElement>(null);
  const desktopTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const mobileDialogRef = useRef<HTMLElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const preview = configuration.mode === "preview";
  const groups = OPERATIONS_NAVIGATION.filter((group) => !group.adminOnly || operatorRole === "ops_admin");
  const primaryGroup = groups.find((group) => group.label === "Daily work");
  const secondaryGroups = groups.filter((group) => group.label !== "Daily work");
  const activeItem = groups
    .flatMap((group) => group.items)
    .find((item) => isCurrentPath(pathname, item.href));

  const closeMobileNavigation = useCallback(() => {
    setMobileOpen(false);
    window.setTimeout(() => mobileTriggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setDesktopMenu(null);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timeout = window.setTimeout(() => mobileCloseRef.current?.focus(), 0);
    const manageDialogKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMobileNavigation();
        return;
      }
      keepFocusInside(event, mobileDialogRef.current);
    };
    document.addEventListener("keydown", manageDialogKeyboard);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("keydown", manageDialogKeyboard);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeMobileNavigation, mobileOpen]);

  useEffect(() => {
    if (!desktopMenu) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!desktopHeaderRef.current?.contains(event.target as Node)) setDesktopMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDesktopMenu(null);
      window.setTimeout(() => desktopTriggerRef.current?.focus(), 0);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [desktopMenu]);

  const mobileNavigation = (
    <nav aria-label="Operations" className="space-y-7">
      {groups.map((group) => (
        <section aria-labelledby={`ops-nav-mobile-${group.label.replaceAll(" ", "-")}`} key={group.label}>
          <h2
            className="px-3 font-cadehandy2 text-xl leading-none text-[var(--color-poster)]"
            id={`ops-nav-mobile-${group.label.replaceAll(" ", "-")}`}
          >
            {group.label}
          </h2>
          <div className="mt-2 space-y-1">
            {group.items.map((item) => {
              const current = isCurrentPath(pathname, item.href);
              return (
                <Link
                  aria-current={current ? "page" : undefined}
                  className={`flex min-h-11 items-center rounded-[4px] border-l-2 px-3 text-sm font-medium transition-colors ${
                    current
                      ? "border-[var(--color-poster)] bg-[var(--color-bone)] text-[#171310]"
                      : "border-transparent text-white/48 hover:bg-white/[0.045] hover:text-white/82"
                  }`}
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );

  const desktopLinkClass = (current: boolean) =>
    `relative inline-flex min-h-[var(--ruined-header-height)] items-center px-2 text-[0.72rem] font-medium transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:transition-colors ${
      current
        ? "text-white after:bg-[var(--color-poster)]"
        : "text-white/48 after:bg-transparent hover:text-white/85"
    }`;

  const toggleDesktopMenu = (label: string, trigger: HTMLButtonElement) => {
    desktopTriggerRef.current = trigger;
    setDesktopMenu((open) => (open === label ? null : label));
  };

  return (
    <>
      <header
        className="fixed inset-x-0 top-0 z-[90] border-b border-white/12 bg-[#080605] font-[var(--font-body)] text-white shadow-[0_8px_28px_rgba(0,0,0,0.18)]"
        ref={desktopHeaderRef}
      >
        <div className="mx-auto flex min-h-[var(--ruined-header-height)] max-w-[100rem] items-stretch px-4 sm:px-6 xl:px-8">
          <Link
            aria-label="Ruined Operations overview"
            className="flex shrink-0 items-center gap-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[var(--color-poster)]"
            href="/ops"
          >
            <Image
              alt="Ruined"
              className="h-7 w-auto brightness-0 invert"
              draggable={false}
              height={300}
              priority
              src="/ruined-wordmark.svg"
              width={1000}
            />
            <span aria-hidden="true" className="h-5 w-px bg-white/20" />
            <span className="text-[0.73rem] font-medium text-white/62">Operations</span>
          </Link>

          <nav aria-label="Operations" className="ml-7 hidden min-w-0 flex-1 items-stretch justify-center gap-1 xl:flex">
            {primaryGroup?.items.map((item) => {
              const current = isCurrentPath(pathname, item.href);
              return (
                <Link
                  aria-current={current ? "page" : undefined}
                  className={desktopLinkClass(current)}
                  href={item.href}
                  key={item.href}
                >
                  {item.label}
                </Link>
              );
            })}

            {secondaryGroups.map((group) => {
              const current = group.items.some((item) => isCurrentPath(pathname, item.href));
              const open = desktopMenu === group.label;
              const menuId = `ops-desktop-${group.label.toLowerCase()}`;
              return (
                <div className="relative flex" key={group.label}>
                  <button
                    aria-controls={menuId}
                    aria-expanded={open}
                    aria-haspopup="menu"
                    className={`${desktopLinkClass(current)} gap-1.5`}
                    onClick={(event) => toggleDesktopMenu(group.label, event.currentTarget)}
                    type="button"
                  >
                    {group.label === "Administration" ? "Admin" : group.label}
                    <span aria-hidden="true" className={`text-[0.55rem] transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
                  </button>
                  {open ? (
                    <div
                      className="absolute right-0 top-[calc(100%-0.35rem)] z-20 min-w-56 rounded-[4px] bg-[var(--color-bone)] p-2 text-[#171310] shadow-[5px_5px_0_var(--color-poster)]"
                      id={menuId}
                      role="menu"
                    >
                      {group.items.map((item) => {
                        const itemCurrent = isCurrentPath(pathname, item.href);
                        return (
                          <Link
                            aria-current={itemCurrent ? "page" : undefined}
                            className={`flex min-h-11 items-center rounded-[3px] px-3 text-sm transition-colors ${
                              itemCurrent
                                ? "bg-[#171310] text-white"
                                : "hover:bg-black/[0.06]"
                            }`}
                            href={item.href}
                            key={item.href}
                            role="menuitem"
                          >
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </nav>

          <div className="ml-auto hidden shrink-0 items-stretch pl-4 xl:flex">
            <button
              aria-controls="ops-desktop-account"
              aria-expanded={desktopMenu === "Account"}
              aria-haspopup="menu"
              className="flex min-h-[var(--ruined-header-height)] max-w-52 items-center gap-2.5 px-2 text-left text-xs text-white/50 transition-colors hover:text-white/85"
              onClick={(event) => toggleDesktopMenu("Account", event.currentTarget)}
              type="button"
            >
              <span aria-hidden="true" className={`size-2 ${configuration.mode === "connected" ? "bg-[var(--color-verdigris)]" : "bg-[var(--color-poster)]"}`} />
              <span className="max-w-36 truncate">{viewerLabel ?? "Operator"}</span>
            </button>
            {desktopMenu === "Account" ? (
              <div
                className="absolute right-8 top-[calc(100%-0.35rem)] z-20 w-64 rounded-[4px] bg-[var(--color-bone)] p-4 text-[#171310] shadow-[5px_5px_0_var(--color-poster)]"
                id="ops-desktop-account"
                role="menu"
              >
                <p className="truncate text-sm font-medium">{viewerLabel ?? "Operator"}</p>
                <p className="mt-1 text-xs text-black/48">
                  {preview ? "Preview workspace" : configuration.mode === "connected" ? "Operator access" : "Services unavailable"}
                </p>
                <div className="mt-4 space-y-1">
                  <Link className="flex min-h-11 items-center rounded-[3px] px-2 text-sm hover:bg-black/[0.06]" href="/access" role="menuitem">
                    My profile
                  </Link>
                  <Link className="flex min-h-11 items-center rounded-[3px] px-2 text-sm hover:bg-black/[0.06]" href="/" role="menuitem">
                    Return to website ↗
                  </Link>
                  {viewerLabel && !preview ? (
                    <form action="/api/auth/sign-out?next=/access" method="post" role="none">
                      <button className="flex min-h-11 w-full items-center rounded-[3px] px-2 text-sm hover:bg-black/[0.06]" role="menuitem" type="submit">
                        Sign out
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <button
            aria-expanded={mobileOpen}
            aria-haspopup="dialog"
            aria-label="Open operations menu"
            className="ml-auto inline-flex min-h-[var(--ruined-header-height)] items-center gap-2.5 px-1 text-sm font-medium text-white xl:hidden"
            onClick={() => setMobileOpen(true)}
            ref={mobileTriggerRef}
            type="button"
          >
            <span aria-hidden="true" className="grid gap-1">
              <span className="h-px w-4 bg-current" />
              <span className="h-px w-4 bg-current" />
              <span className="h-px w-4 bg-current" />
            </span>
            <span>Menu</span>
          </button>
        </div>
      </header>

      {mobileOpen ? (
        <div className="fixed inset-0 z-[180] bg-black/65 xl:hidden" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) closeMobileNavigation();
        }}>
          <aside
            aria-labelledby="operations-mobile-menu-title"
            aria-modal="true"
            className="ml-auto h-full w-[min(92vw,24rem)] overflow-y-auto bg-[#080605] px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pt-[calc(1.5rem+env(safe-area-inset-top,0px))] text-white shadow-[-10px_0_0_rgba(208,49,45,0.8)]"
            ref={mobileDialogRef}
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <Image alt="Ruined" className="h-7 w-auto brightness-0 invert" draggable={false} height={300} src="/ruined-wordmark.svg" width={1000} />
                  <span aria-hidden="true" className="h-5 w-px bg-white/20" />
                  <p className="text-sm font-medium text-white/65" id="operations-mobile-menu-title">Operations</p>
                </div>
                <p className="mt-3 text-xs text-white/38">{activeItem?.label ?? "Access"}</p>
              </div>
              <button
                aria-label="Close operations menu"
                className="inline-flex size-12 items-center justify-center rounded-full border border-white/20 text-2xl"
                onClick={closeMobileNavigation}
                ref={mobileCloseRef}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="mt-8">{mobileNavigation}</div>
            <div className="mt-8 flex flex-col items-start gap-3 border-t border-white/10 pt-5 text-sm text-white/45">
              <ConnectionMark
                label={preview ? "Preview" : configuration.mode === "connected" ? "Live" : "Unavailable"}
                state={configuration.mode === "connected" ? "connected" : "disconnected"}
              />
              {viewerLabel ? <p className="max-w-full truncate text-xs normal-case">{viewerLabel}</p> : null}
              <Link className="inline-flex min-h-11 items-center hover:text-white" href="/access">My profile</Link>
              {viewerLabel && !preview ? (
                <form action="/api/auth/sign-out?next=/access" method="post">
                  <button className="min-h-11 hover:text-white" type="submit">Sign out</button>
                </form>
              ) : null}
              <Link className="inline-flex min-h-11 items-center hover:text-white" href="/">Return to website ↗</Link>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}

function isMemberThreshold(pathname: string): boolean {
  return (
    pathname.startsWith("/my/access") ||
    pathname.startsWith("/my/confirmed") ||
    pathname.startsWith("/my/join")
  );
}

function isMemberFoundations(pathname: string): boolean {
  return pathname.startsWith("/my/foundations");
}

export default function PlatformShell({
  children,
  configuration,
  operatorRole,
  surface,
  viewerLabel,
}: {
  children: React.ReactNode;
  configuration: PlatformConfiguration;
  operatorRole?: OperatorNavigationRole | null;
  surface: PlatformSurface;
  viewerLabel?: string | null;
}) {
  const pathname = usePathname();
  const preview = configuration.mode === "preview";
  const member = surface === "member";
  const threshold = member && isMemberThreshold(pathname);
  const membershipEntry = member && pathname === "/my/join";
  const memberHome = member && pathname === "/my";
  const memberCircle = member && pathname.startsWith("/my/circle");
  const memberExperiences = member && pathname.startsWith("/my/experiences");
  const memberLearning = member && pathname.startsWith("/my/learn");
  const memberSupport = member && pathname.startsWith("/my/support");
  const foundations = member && isMemberFoundations(pathname);
  const foundationsExperience = pathname.startsWith("/my/foundations/experience");
  const timeline = member && pathname === "/my/foundations/timeline";
  const paperSurface = memberHome || memberCircle || memberExperiences || memberLearning || memberSupport || timeline;
  const paperClass = timeline
    ? "member-timeline-paper"
    : memberHome || memberCircle || memberExperiences || memberLearning || memberSupport
      ? "member-profile-paper"
      : "";
  const dark = !member || threshold || (foundations && !timeline);

  return (
    <div
      className={`min-h-screen pt-[var(--ruined-header-height)] ${paperClass} ${
        dark
          ? "bg-[#080605] text-[var(--color-bone)]"
          : "bg-[var(--color-bone)] text-[#201d19]"
      }`}
      data-platform-member-home={memberHome ? "true" : undefined}
      data-platform-surface={surface}
      data-platform-threshold={threshold ? "true" : undefined}
    >
      {member ? (
        <PlatformUtilityRail
          configuration={configuration}
          dark={dark}
          hideBrand={paperSurface}
          operatorRole={operatorRole}
          surface={surface}
          viewerLabel={viewerLabel}
        />
      ) : (
        <OperationsNavigation
          configuration={configuration}
          operatorRole={operatorRole}
          pathname={pathname}
          viewerLabel={viewerLabel}
        />
      )}

      <div>
        {configuration.mode !== "connected" ? (
          <div
            className={`border-b border-[var(--color-poster)]/50 px-4 text-center font-[var(--font-body)] tracking-[0.03em] sm:px-6 ${
              memberHome ? "py-2 text-[0.6rem] leading-snug" : "py-3 text-[0.67rem] leading-relaxed"
            } ${
              dark
                ? "bg-[var(--color-poster)]/10 text-white/60"
                : "bg-[var(--color-poster)]/[0.07] text-black/65"
            }`}
            role="status"
          >
            {preview
              ? member
                ? memberHome
                  ? "Preview only. Identity and payment are not live."
                  : "Preview data. Member identity and payment activation are not live."
                : "Preview data. Operator changes and connected services are not live."
              : member
                ? "Membership is temporarily unavailable because its required services are not connected."
                : "Operations are temporarily unavailable because required services are not connected."}
          </div>
        ) : null}

        <div
          className={`mx-auto max-w-[96rem] px-4 sm:px-6 lg:px-10 ${
            membershipEntry
              ? "pb-10 sm:pb-14 lg:pb-16"
              : paperSurface
                ? "pb-0 pt-3 sm:pt-4 lg:pt-5"
              : "py-10 sm:py-14 lg:py-16"
          }`}
        >
          {children}
        </div>

        <footer
          className={`border-t px-4 font-[var(--font-body)] text-[0.64rem] uppercase tracking-[0.1em] sm:px-6 lg:px-10 ${
            paperSurface
              ? "border-transparent py-4 text-black/42"
              : dark
                ? "border-white/10 py-7 text-white/55"
                : "border-black/15 py-7 text-black/60"
          }`}
        >
          <div className="mx-auto flex max-w-[96rem] flex-wrap justify-between gap-3">
            <span>The Ruined Project</span>
            {!paperSurface ? <span>{member ? "Members & Membership" : "Internal operations"}</span> : null}
          </div>
        </footer>
      </div>

      {member && !threshold && !foundationsExperience ? <MemberNavigationFab /> : null}
    </div>
  );
}

export function PlatformConnectionRail({
  configuration,
}: {
  configuration: PlatformConfiguration;
}) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-white/12 py-3 font-[var(--font-body)] text-[0.62rem] uppercase tracking-[0.13em] text-white/38">
      <ConnectionMark label="Supabase" state={configuration.supabase} />
      <ConnectionMark label="Stripe" state={configuration.stripe} />
      <ConnectionMark label="Postgres" state={configuration.database} />
    </div>
  );
}
