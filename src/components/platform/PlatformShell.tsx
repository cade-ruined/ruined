"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { PlatformConfiguration } from "@/lib/platform/config";

type PlatformSurface = "member" | "ops";

const NAVIGATION: Record<PlatformSurface, ReadonlyArray<{ href: string; label: string }>> = {
  member: [
    { href: "/my", label: "Home" },
    { href: "/my/foundations", label: "Foundations" },
    { href: "/my/circle", label: "Circle" },
    { href: "/my/artifacts", label: "Artifacts" },
    { href: "/my/account", label: "Account" },
  ],
  ops: [
    { href: "/ops", label: "Overview" },
    { href: "/ops/members", label: "Members" },
    { href: "/ops/circles", label: "Circles" },
    { href: "/ops/sync", label: "Sync" },
  ],
};

function isCurrentPath(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === "/my" || href === "/ops") return false;
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

  return (
    <div className="min-h-screen bg-[#080605] text-[#f3f0e8]">
      <header className="sticky top-0 z-50 border-b border-white/15 bg-[#080605]/95 backdrop-blur-md">
        <div className="mx-auto flex min-h-16 max-w-[96rem] items-center justify-between gap-6 px-4 sm:px-6 lg:px-10">
          <div className="flex min-w-0 items-center gap-4 sm:gap-7">
            <Link
              className="font-[var(--font-header)] text-xl font-bold uppercase tracking-[-0.04em] text-white"
              href={surface === "member" ? "/my" : "/ops"}
            >
              Ruined
            </Link>
            <span className="h-5 w-px bg-white/20" aria-hidden="true" />
            <span className="truncate font-mono text-[0.58rem] uppercase tracking-[0.24em] text-white/45">
              {surface === "member" ? "My Ruined" : "Operations"}
            </span>
          </div>

          <div className="flex items-center gap-3 font-mono text-[0.56rem] uppercase tracking-[0.18em] text-white/45">
            <span className={preview ? "text-[var(--color-poster)]" : "text-white/55"}>
              {preview ? "Preview" : configuration.mode === "connected" ? "Connected" : "Unavailable"}
            </span>
            {viewerLabel ? <span className="hidden max-w-48 truncate sm:inline">{viewerLabel}</span> : null}
            {viewerLabel && !preview ? (
              <form
                action={`/api/auth/sign-out?next=${surface === "ops" ? "/ops/access" : "/my/access"}`}
                method="post"
              >
                <button className="border-l border-white/20 pl-3 text-white/55 hover:text-white" type="submit">
                  Sign out
                </button>
              </form>
            ) : null}
          </div>
        </div>

        <div className="border-t border-white/10">
          <div className="mx-auto flex max-w-[96rem] items-center gap-7 overflow-x-auto px-4 sm:px-6 lg:px-10">
            <nav aria-label={surface === "member" ? "Member" : "Operations"} className="flex min-w-max">
              {NAVIGATION[surface].map((item) => {
                const current = isCurrentPath(pathname, item.href);
                return (
                  <Link
                    aria-current={current ? "page" : undefined}
                    className={`border-b px-3 py-3 font-mono text-[0.58rem] uppercase tracking-[0.2em] transition-colors first:pl-0 ${
                      current
                        ? "border-white text-white"
                        : "border-transparent text-white/38 hover:text-white/75"
                    }`}
                    href={item.href}
                    key={item.href}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <Link
              className="ml-auto hidden whitespace-nowrap font-mono text-[0.56rem] uppercase tracking-[0.18em] text-white/35 hover:text-white sm:block"
              href="/"
            >
              Public site ↗
            </Link>
          </div>
        </div>
      </header>

      {configuration.mode !== "connected" ? (
        <div className="border-b border-[var(--color-poster)]/55 bg-[var(--color-poster)]/10 px-4 py-2.5 text-center font-mono text-[0.57rem] uppercase leading-relaxed tracking-[0.18em] text-white/60 sm:px-6">
          {preview
            ? "Preview data · Supabase identity and Stripe activation are not live"
            : "Platform unavailable · required services are not configured"}
        </div>
      ) : null}

      <div className="mx-auto max-w-[96rem] px-4 py-8 sm:px-6 sm:py-12 lg:px-10">
        {children}
      </div>

      <footer className="border-t border-white/10 px-4 py-6 font-mono text-[0.54rem] uppercase tracking-[0.18em] text-white/25 sm:px-6 lg:px-10">
        <div className="mx-auto flex max-w-[96rem] flex-wrap justify-between gap-3">
          <span>The Ruined Project</span>
          <span>{surface === "member" ? "Private member system" : "Internal operations system"}</span>
        </div>
      </footer>
    </div>
  );
}

export function PlatformConnectionRail({
  configuration,
}: {
  configuration: PlatformConfiguration;
}) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-2 border-y border-white/12 py-3 font-mono text-[0.55rem] uppercase tracking-[0.16em] text-white/38">
      <ConnectionMark label="Supabase" state={configuration.supabase} />
      <ConnectionMark label="Stripe" state={configuration.stripe} />
      <ConnectionMark label="Postgres" state={configuration.database} />
    </div>
  );
}
