"use client";

import type { MouseEventHandler } from "react";
import Link from "next/link";
import { BagGlyph } from "@/components/nav/BagGlyph";
import { SITE_ROUTES } from "@/data/navigation";
import { useBag } from "./bag-store";

export default function BagLink({
  className = "",
  current = false,
  onClick,
  variant = "label",
}: {
  className?: string;
  current?: boolean;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  variant?: "label" | "icon";
}) {
  const { count, hydrated } = useBag();
  const visibleCount = count > 99 ? "99+" : String(count);

  return (
    <Link
      href={SITE_ROUTES.bag.href}
      className={className}
      data-bag-link={variant}
      aria-current={current ? "page" : undefined}
      aria-label={`Bag, ${count} ${count === 1 ? "item" : "items"}`}
      onClick={onClick}
    >
      {variant === "icon" ? (
        <span className="relative flex h-10 w-11 items-center justify-center">
          <BagGlyph className="ruined-bag-glyph h-10 w-9" />
          {hydrated && count > 0 && (
            <span
              data-bag-count
              className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-primary)] px-1 font-[var(--font-header)] text-[0.48rem] font-bold leading-none tracking-normal text-white shadow-[0_0_9px_rgba(208,49,45,0.7)] tabular-nums"
            >
              {visibleCount}
            </span>
          )}
        </span>
      ) : (
        <>Bag{hydrated && count > 0 ? ` ${count}` : ""}</>
      )}
    </Link>
  );
}
