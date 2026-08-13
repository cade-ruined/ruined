"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GLOBAL_NAV_ITEMS } from "@/data/navigation";

// Slim lateral nav for the deep pages, replacing the couch there. The current
// page is marked (poster-red, non-link); the siblings are quiet links so you
// can hop store ↔ work ↔ about without bouncing through the home hub. Inherits
// its host footer's typography; only sets tracking/size.
export default function SiblingNav({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Sections"
      className={`ui-heading flex items-center gap-3 text-[0.65rem] tracking-[0.18em] uppercase ${className}`}
    >
      {GLOBAL_NAV_ITEMS.map((r, i) => {
        const active = pathname.startsWith(r.href);
        return (
          <span key={r.href} className="flex items-center gap-3">
            {i > 0 && (
              <span aria-hidden className="opacity-30">
                ·
              </span>
            )}
            {active ? (
              <span aria-current="page" className="text-[var(--color-primary)]">
                {r.label}
              </span>
            ) : (
              <Link
                href={r.href}
                className="opacity-60 transition-opacity duration-200 hover:opacity-100"
              >
                {r.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
