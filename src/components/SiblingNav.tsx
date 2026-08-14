"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  activeGlobalNavigationId,
  WALK_SECTION_ITEMS,
} from "@/data/navigation";

// Slim lateral nav for the deep pages, replacing the couch there. The current
// page is marked while every destination returns to its room in the immersive
// walk. This keeps dormant standalone sections from linking to one another.
// Inherits its host footer's typography; only sets tracking/size.
export default function SiblingNav({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const activeId = activeGlobalNavigationId(pathname);
  return (
    <nav
      aria-label="Sections"
      className={`ui-heading flex items-center gap-3 text-[0.65rem] tracking-[0.18em] uppercase ${className}`}
    >
      {WALK_SECTION_ITEMS.map((room, i) => {
        const active = activeId === room.id;
        return (
          <span key={room.id} className="flex items-center gap-3">
            {i > 0 && (
              <span aria-hidden className="opacity-30">
                ·
              </span>
            )}
            <Link
              href={room.href}
              aria-current={active ? "page" : undefined}
              className={active
                ? "text-[var(--color-primary)]"
                : "opacity-60 transition-opacity duration-200 hover:opacity-100"}
            >
              {room.label}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}
