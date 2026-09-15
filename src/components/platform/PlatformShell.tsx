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
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const workspaceTriggerRef = useRef<HTMLButtonElement>(null);
  const preview = configuration.mode === "preview";
  const groups = getOperationsNavigation(operatorRole);
  const location = getOperationsLocation(pathname, groups);
  const currentWorkspace = location?.item.label ?? "Select workspace";

  function showNavigation() {
    setWorkspaceOpen(false);
    // Keep workspace changes at the start of the page, without Next moving
    // the focusable main beneath the fixed header.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }

  useEffect(() => {
    setAccountOpen(false);
    setWorkspaceOpen(false);
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

  useEffect(() => {
    if (!workspaceOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!workspaceRef.current?.contains(event.target as Node)) setWorkspaceOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setWorkspaceOpen(false);
      workspaceTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [workspaceOpen]);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-[90] bg-[#080605] font-[var(--font-body)] text-white" data-operator-navigation>
        <a className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-10 focus:rounded-[4px] focus:bg-[var(--color-signal)] focus:px-4 focus:py-3 focus:text-black" href="#operator-content">Skip to page content</a>
        <div className="mx-auto flex min-h-[var(--ruined-header-height)] max-w-[100rem] items-center gap-2 px-4 pt-[env(safe-area-inset-top,0px)] sm:gap-4 sm:px-6 lg:px-10">
          <Link aria-label="Ruined Operations overview" className="flex shrink-0 items-center gap-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)]" href="/ops" scroll={false} onNavigate={showNavigation}>
            <Image alt="Ruined" className="h-6 w-auto brightness-0 invert sm:h-7" draggable={false} height={300} priority src="/ruined-wordmark.svg" width={1000} />
            <span className="hidden [font-family:var(--font-cadehandy2)] text-2xl text-white/75 sm:inline">Operations</span>
          </Link>
          {groups.length ? (
            <div
              className="relative min-w-0 sm:ml-3"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setWorkspaceOpen(false);
              }}
              ref={workspaceRef}
            >
              <button
                aria-controls="ops-workspaces"
                aria-expanded={workspaceOpen}
                aria-label={`Workspace: ${currentWorkspace}`}
                className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-[8px] bg-white/10 px-3 text-sm font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-signal)] sm:min-w-40 sm:justify-between"
                onClick={() => {
                  setAccountOpen(false);
                  setWorkspaceOpen((open) => !open);
                }}
                ref={workspaceTriggerRef}
                type="button"
              >
                <span className="truncate">{currentWorkspace}</span>
                <svg aria-hidden="true" className={`size-3 shrink-0 transition-transform motion-reduce:transition-none ${workspaceOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 12 12"><path d="m2.5 4.5 3.5 3 3.5-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg>
              </button>
              {workspaceOpen ? (
                <nav
                  aria-label="Operator workspaces"
                  className="fixed inset-x-4 top-[calc(var(--ruined-header-height)+0.5rem)] max-h-[calc(100dvh-var(--ruined-header-height)-1.5rem)] overflow-y-auto overscroll-contain rounded-[8px] bg-[var(--color-bone)] p-2 text-[var(--color-faded)] shadow-[3px_3px_0_var(--color-faded)] sm:absolute sm:inset-x-auto sm:left-0 sm:top-[calc(100%+0.75rem)] sm:w-64"
                  id="ops-workspaces"
                >
                  {groups.flatMap((group) => group.items).map((item) => {
                    const current = isOperationsPathCurrent(pathname, item.href);
                    return <Link
                      aria-current={current ? "page" : undefined}
                      className={`flex min-h-11 items-center justify-between gap-3 rounded-[6px] px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-poster)] ${current ? "bg-[var(--color-faded)] font-semibold text-[var(--color-bone)]" : "hover:bg-black/[0.06]"}`}
                      href={item.href}
                      key={item.href}
                      onNavigate={showNavigation}
                      scroll={false}
                    >
                      {item.label}
                      {current ? <svg aria-hidden="true" className="size-4 shrink-0" fill="none" viewBox="0 0 16 16"><path d="m3 8 3 3 7-7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" /></svg> : null}
                    </Link>;
                  })}
                </nav>
              ) : null}
            </div>
          ) : null}
          <div className="relative ml-auto shrink-0" ref={accountRef}>
            <button
              aria-controls="ops-account"
              aria-expanded={accountOpen}
              aria-label="Account"
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-[8px] px-2 text-sm text-white/75 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)]"
              onClick={() => {
                setWorkspaceOpen(false);
                setAccountOpen((open) => !open);
              }}
              ref={accountTriggerRef}
              type="button"
            >
              <span className="hidden max-w-48 truncate lg:block">{viewerLabel ?? "Operator"}</span>
              <span className="hidden sm:inline">Account</span>
              <svg aria-hidden="true" className="size-6 sm:hidden" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" /><circle cx="12" cy="9" r="3" stroke="currentColor" strokeWidth="1.5" /><path d="M5.5 18c1-3 3.5-4.5 6.5-4.5s5.5 1.5 6.5 4.5" stroke="currentColor" strokeWidth="1.5" /></svg>
              <span aria-hidden="true" className={`hidden sm:inline ${accountOpen ? "rotate-180" : ""}`}>⌄</span>
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
  const memberSettings = member && (pathname === "/my/account" || pathname === "/my/profile");
  const foundations = member && isMemberFoundations(pathname);
  const foundationsExperience = pathname.startsWith("/my/foundations/experience");
  const timeline = member && pathname === "/my/foundations/timeline";
  const paperSurface = memberHome || memberCircle || memberExperiences || memberLearning || memberSupport || memberSettings || timeline;
  const paperClass = timeline
    ? "member-timeline-paper"
    : memberHome || memberCircle || memberExperiences || memberLearning || memberSupport || memberSettings
      ? "member-profile-paper"
      : "";
  const dark = !member || threshold || (foundations && !timeline);

  return (
    <div
      className={`min-h-screen pt-[var(--ruined-header-height)] ${paperClass} ${!member ? "operator-paper" : ""} ${
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
              !member
                ? "bg-[var(--color-poster)]/[0.07] text-black/60"
              : dark
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

        {member ? <footer
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
        </footer> : null}
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
