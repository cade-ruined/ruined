"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function SiteFooter() {
  const pathname = usePathname();
  if (pathname.startsWith("/dive") || pathname.startsWith("/sequence") || pathname.startsWith("/lp")) return null;

  return (
    <footer className="relative z-30 border-t border-black/15 bg-[var(--color-bone)] px-6 pt-12 text-[var(--color-faded)] sm:px-10 sm:pt-16" style={{ paddingBottom: "calc(var(--bottom-menu-h, 190px) + env(safe-area-inset-bottom, 0px) + 2rem)" }}>
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-10 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-1">
          <p className="display text-3xl">Ruined</p>
          <p className="mt-2 max-w-xs text-xs leading-relaxed opacity-60">Objects, garments, spaces, and project records from Studio No. 17.</p>
        </div>
        <FooterColumn title="Index" links={[["Store", "/store"], ["Work", "/work"], ["Events", "/events"], ["About", "/about"], ["Contact", "/contact"]]} />
        <FooterColumn title="Service" links={[["Shipping + Returns", "/shipping-returns"], ["Terms", "/terms"], ["Privacy", "/privacy"]]} />
        <div>
          <p className="font-mono text-[0.58rem] uppercase tracking-[0.3em] opacity-45">Studio</p>
          <a className="mt-4 block text-sm underline underline-offset-4" href="mailto:studio@ruined.studio">studio@ruined.studio</a>
          <p className="mt-3 font-mono text-[0.58rem] uppercase tracking-[0.2em] opacity-55">40.4633° N · 111.7780° W</p>
        </div>
      </div>
      <div className="mx-auto mt-12 flex max-w-6xl flex-wrap justify-between gap-3 border-t border-black/15 pt-5 font-mono text-[0.55rem] uppercase tracking-[0.22em] opacity-55">
        <span>© 2026 The Ruined Project</span><span>After the fear</span>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: [string, string][] }) {
  return <div><p className="font-mono text-[0.58rem] uppercase tracking-[0.3em] opacity-45">{title}</p><ul className="mt-4 space-y-2 text-sm">{links.map(([label, href]) => <li key={href}><Link className="hover:text-[var(--color-poster)]" href={href}>{label}</Link></li>)}</ul></div>;
}
