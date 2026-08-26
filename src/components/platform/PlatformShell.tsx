"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import MemberNavigationFab from "@/components/platform/MemberNavigationFab";
import type { PlatformConfiguration } from "@/lib/platform/config";

type PlatformSurface = "member" | "ops";

const OPERATIONS_NAVIGATION = [
  { href: "/ops", label: "Overview" },
  { href: "/ops/members", label: "Members" },
  { href: "/ops/foundations", label: "Foundations" },
  { href: "/ops/circles", label: "Circles" },
  { href: "/ops/blocks", label: "Blocks" },
  { href: "/ops/access-billing", label: "Access & Billing" },
] as const;

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
        className={`size-1.5 ${state === "connected" ? "bg-emerald-400" : "bg-white/25"}`}
      />
      {label} {state === "connected" ? "on" : "off"}
    </span>
  );
}

function PlatformUtilityRail({
  configuration,
  dark,
  surface,
  viewerLabel,
}: {
  configuration: PlatformConfiguration;
  dark: boolean;
  surface: PlatformSurface;
  viewerLabel?: string | null;
}) {
  const preview = configuration.mode === "preview";

  return (
    <div
      className={`border-b font-[var(--font-body)] ${
        dark ? "border-white/12 text-white" : "border-black/15 text-[#201d19]"
      }`}
    >
      <div className="mx-auto flex min-h-14 max-w-[96rem] flex-wrap items-center justify-between gap-x-8 gap-y-2 px-4 py-3 sm:px-6 lg:px-10">
        <p className="text-[0.66rem] font-medium uppercase tracking-[0.18em] opacity-70">
          {surface === "member" ? "Ruined Membership" : "Ruined Operations"}
        </p>

        <div className="flex min-w-0 items-center gap-3 text-[0.64rem] uppercase tracking-[0.12em]">
          <span
            className={
              preview
                ? "text-[var(--color-poster)]"
                : configuration.mode === "connected"
                  ? "opacity-50"
                  : "text-[var(--color-poster)]"
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
          {viewerLabel && !preview ? (
            <form
              action={`/api/auth/sign-out?next=${surface === "ops" ? "/ops/access" : "/my/access"}`}
              className="border-l border-current/20 pl-3"
              method="post"
            >
              <button
                className="uppercase tracking-[0.12em] opacity-55 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)]"
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

function OperationsNavigation({ pathname }: { pathname: string }) {
  const railRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const rail = railRef.current;
    const current = currentRef.current;
    if (!rail || !current) return;

    const centeredLeft =
      current.offsetLeft - (rail.clientWidth - current.clientWidth) / 2;
    rail.scrollTo({ left: Math.max(0, centeredLeft), behavior: "auto" });
  }, [pathname]);

  return (
    <div className="border-b border-white/12">
      <div
        className="ops-navigation-rail mx-auto flex max-w-[96rem] items-center gap-8 overflow-x-auto px-4 sm:px-6 lg:px-10"
        ref={railRef}
      >
        <nav aria-label="Operations" className="flex min-w-max">
          {OPERATIONS_NAVIGATION.map((item) => {
            const current = isCurrentPath(pathname, item.href);
            return (
              <Link
                aria-current={current ? "page" : undefined}
                className={`border-b px-3 py-4 font-[var(--font-body)] text-[0.68rem] font-medium uppercase tracking-[0.15em] transition-colors first:pl-0 ${
                  current
                    ? "border-[var(--color-poster)] text-white"
                    : "border-transparent text-white/42 hover:text-white/80"
                }`}
                href={item.href}
                key={item.href}
                ref={current ? currentRef : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <Link
          className="ml-auto hidden whitespace-nowrap font-[var(--font-body)] text-[0.66rem] uppercase tracking-[0.13em] text-white/35 transition-colors hover:text-white sm:block"
          href="/"
        >
          Public site ↗
        </Link>
      </div>
    </div>
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
  surface,
  viewerLabel,
}: {
  children: React.ReactNode;
  configuration: PlatformConfiguration;
  surface: PlatformSurface;
  viewerLabel?: string | null;
}) {
  const pathname = usePathname();
  const preview = configuration.mode === "preview";
  const member = surface === "member";
  const threshold = member && isMemberThreshold(pathname);
  const foundations = member && isMemberFoundations(pathname);
  const foundationsExperience = pathname.startsWith("/my/foundations/experience");
  const dark = !member || threshold || foundations;

  return (
    <div
      className={`min-h-screen pt-[var(--ruined-header-height)] ${
        dark
          ? "bg-[#080605] text-[var(--color-bone)]"
          : "bg-[var(--color-bone)] text-[#201d19]"
      }`}
      data-platform-surface={surface}
      data-platform-threshold={threshold ? "true" : undefined}
    >
      <PlatformUtilityRail
        configuration={configuration}
        dark={dark}
        surface={surface}
        viewerLabel={viewerLabel}
      />

      {!member ? <OperationsNavigation pathname={pathname} /> : null}

      {configuration.mode !== "connected" ? (
        <div
          className={`border-b border-[var(--color-poster)]/50 px-4 py-3 text-center font-[var(--font-body)] text-[0.67rem] leading-relaxed tracking-[0.03em] sm:px-6 ${
            dark
              ? "bg-[var(--color-poster)]/10 text-white/60"
              : "bg-[var(--color-poster)]/[0.07] text-black/65"
          }`}
          role="status"
        >
          {preview
            ? member
              ? "Preview data. Member identity and payment activation are not live."
              : "Preview data. Operator changes and connected services are not live."
            : member
              ? "Membership is temporarily unavailable because its required services are not connected."
              : "Operations are temporarily unavailable because required services are not connected."}
        </div>
      ) : null}

      <div className="mx-auto max-w-[96rem] px-4 py-10 sm:px-6 sm:py-14 lg:px-10 lg:py-16">
        {children}
      </div>

      <footer
        className={`border-t px-4 py-7 font-[var(--font-body)] text-[0.64rem] uppercase tracking-[0.14em] sm:px-6 lg:px-10 ${
          dark ? "border-white/10 text-white/30" : "border-black/15 text-black/45"
        }`}
      >
        <div className="mx-auto flex max-w-[96rem] flex-wrap justify-between gap-3">
          <span>The Ruined Project</span>
          <span>{member ? "Members & Membership" : "Internal operations"}</span>
        </div>
      </footer>

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
