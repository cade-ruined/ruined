"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import MemberNavigationFab from "@/components/platform/MemberNavigationFab";
import type { PlatformConfiguration } from "@/lib/platform/config";
import {
  getOperationsLocation,
  getOperationsNavigation,
  isOperationsPathCurrent,
  type OperatorNavigationRole,
} from "@/lib/platform/operations-navigation";
import { publicWebsiteHref } from "@/lib/site";

type PlatformSurface = "member" | "ops";

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

export function OperationsNavigation({
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
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const preview = configuration.mode === "preview";
  const groups = getOperationsNavigation(operatorRole);
  const location = getOperationsLocation(pathname, groups);

  function showNavigation() {
    // Header destinations start above the page content. Next's default focus
    // can scroll the focusable main past these rails, even from the page top.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }

  useEffect(() => {
    setAccountOpen(false);
  }, [operatorRole, pathname]);

  useEffect(() => {
    if (!accountOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setAccountOpen(false);
      accountTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountOpen]);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-[90] bg-[#080605] font-[var(--font-body)] text-white">
        <a className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-10 focus:rounded-[4px] focus:bg-[var(--color-signal)] focus:px-4 focus:py-3 focus:text-black" href="#operator-content">Skip to page content</a>
        <div className="mx-auto flex min-h-[var(--ruined-header-height)] max-w-[100rem] items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
          <Link aria-label="Ruined Operations overview" className="flex shrink-0 items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)]" href="/ops" scroll={false} onNavigate={showNavigation}>
            <Image alt="Ruined" className="h-6 w-auto brightness-0 invert sm:h-7" draggable={false} height={300} priority src="/ruined-wordmark.svg" width={1000} />
            <span className="[font-family:var(--font-cadehandy2)] text-xl text-white/75 sm:text-2xl">Operations</span>
          </Link>
          <div className="relative min-w-0" ref={accountRef}>
            <button
              aria-controls="ops-account"
              aria-expanded={accountOpen}
              className="inline-flex min-h-11 items-center gap-2 rounded-[4px] px-2 text-sm text-white/75 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)]"
              onClick={() => setAccountOpen((open) => !open)}
              ref={accountTriggerRef}
              type="button"
            >
              <span className="hidden max-w-48 truncate lg:block">{viewerLabel ?? "Operator"}</span>
              <span>Account</span>
              <span aria-hidden="true" className={accountOpen ? "rotate-180" : undefined}>⌄</span>
            </button>
            {accountOpen ? (
              <div aria-label="Operator account" className="absolute right-0 top-full z-20 w-64 max-w-[calc(100vw-2rem)] rounded-[4px] bg-[var(--color-bone)] p-3 text-[var(--color-faded)] shadow-[4px_4px_0_var(--color-poster)]" id="ops-account" role="region">
                <p className="break-words px-2 py-1 text-sm font-medium">{viewerLabel ?? "Operator"}</p>
                <p className="px-2 pb-3 text-xs text-black/55">{preview ? "Preview workspace" : configuration.mode === "connected" ? "Signed in" : "Services unavailable"}</p>
                <Link className="flex min-h-11 items-center rounded-[4px] px-2 text-sm hover:bg-black/[0.06]" href="/my">My profile</Link>
                <Link className="flex min-h-11 items-center rounded-[4px] px-2 text-sm hover:bg-black/[0.06]" href={publicWebsiteHref("/")}>Return to website ↗</Link>
                {viewerLabel && !preview ? <form action="/api/auth/sign-out?next=/access" method="post">
                  <button className="flex min-h-11 w-full items-center rounded-[4px] px-2 text-sm hover:bg-black/[0.06]" type="submit">Sign out</button>
                </form> : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {groups.length ? (
        <div className="bg-[var(--color-bone)] px-4 pb-3 pt-3 font-[var(--font-body)] text-[var(--color-faded)] sm:px-6 lg:px-10" data-operator-navigation>
          <div className="mx-auto max-w-[96rem]">
            <nav aria-label="Operations sections" className="flex flex-wrap gap-1 sm:gap-2">
              {groups.map((group) => (
                <Link
                  aria-current={location?.group.id === group.id ? group.items.length === 1 ? "page" : "location" : undefined}
                  className={`inline-flex min-h-11 shrink-0 items-center rounded-[4px] px-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-poster)] sm:px-4 ${location?.group.id === group.id ? "bg-[var(--color-faded)] text-[var(--color-bone)]" : "text-black/60 hover:bg-black/[0.06] hover:text-black"}`}
                  href={group.items[0].href}
                  key={group.id}
                  scroll={false}
                  onNavigate={showNavigation}
                >{group.label}</Link>
              ))}
            </nav>
            {location && location.group.items.length > 1 ? (
              <nav aria-label={`${location.group.label} pages`} className="mt-1 flex flex-wrap gap-x-4 sm:gap-x-6">
                {location.group.items.map((item) => {
                  const current = isOperationsPathCurrent(pathname, item.href);
                  return <Link
                    aria-current={current ? "page" : undefined}
                    className={`inline-flex min-h-11 shrink-0 items-center border-b-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-poster)] ${current ? "border-[var(--color-poster)] font-semibold text-[var(--color-faded)]" : "border-transparent text-black/55 hover:border-black/20 hover:text-black"}`}
                    href={item.href}
                    key={item.href}
                    scroll={false}
                    onNavigate={showNavigation}
                  >{item.label}</Link>;
                })}
              </nav>
            ) : !location ? <p className="py-3 text-sm text-black/55">Choose a section to continue.</p> : null}
          </div>
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
