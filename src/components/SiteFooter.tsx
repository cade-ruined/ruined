"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FOOTER_INDEX_ITEMS,
  SERVICE_NAV_ITEMS,
} from "@/data/navigation";

export default function SiteFooter() {
  const pathname = usePathname();
  if (
    pathname === "/" ||
    pathname.startsWith("/dive") ||
    pathname.startsWith("/sequence") ||
    pathname.startsWith("/lp") ||
    pathname === "/foundations"
  ) return null;

  return (
    <footer className="relative z-30 border-t border-black/15 bg-[var(--color-bone)] px-6 pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] pt-12 text-[var(--color-faded)] sm:px-10 sm:pt-16 md:pb-8">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-10 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-1">
          <Image
            src="/ruined-wordmark.svg"
            alt="RUINED"
            width={1000}
            height={300}
            className="h-auto w-28"
          />
          <p className="mt-2 max-w-xs text-xs leading-relaxed opacity-60">The Ruined Project · Alpine, Utah.</p>
        </div>
        <FooterColumn title="Index" links={FOOTER_INDEX_ITEMS} />
        <FooterColumn title="Service" links={SERVICE_NAV_ITEMS} />
        <div className="min-w-0">
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.3em] opacity-45">Studio</p>
          <Link className="mt-4 block text-[clamp(0.65rem,1.2vw,0.875rem)] underline underline-offset-4 [overflow-wrap:anywhere]" href="/contact">connect@theruinedproject.com</Link>
          <p className="mt-3 font-mono text-[0.58rem] uppercase tracking-[0.2em] opacity-55">40.4478° N · 111.7783° W</p>
        </div>
      </div>
      <div className="mx-auto mt-12 flex max-w-6xl flex-wrap justify-between gap-3 border-t border-black/15 pt-5 font-mono text-[0.55rem] uppercase tracking-[0.22em] opacity-55">
        <span>© 2026 The Ruined Project</span><span>After the fear</span>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: ReadonlyArray<{ label: string; href: string }>;
}) {
  return <div><p className="font-mono text-[0.58rem] uppercase tracking-[0.3em] opacity-45">{title}</p><ul className="mt-4 space-y-2 text-sm">{links.map(({ label, href }) => <li key={href}><Link className="hover:text-[var(--color-poster)]" href={href}>{label}</Link></li>)}</ul></div>;
}
