"use client";

import Link from "next/link";
import type { ReactNode } from "react";

/** Canonical links open the shared intercepted profile on ordinary navigation. */
export default function MemberProfileLink({ href, children, className, onNavigate }: {
  href: string; children: ReactNode; className?: string; onNavigate?: () => void;
}) {
  return <Link href={href} prefetch={false} scroll={false} className={className} aria-haspopup="dialog" data-member-profile-link
    onClick={event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.currentTarget.focus({ preventScroll: true });
      onNavigate?.();
    }}>{children}</Link>;
}
