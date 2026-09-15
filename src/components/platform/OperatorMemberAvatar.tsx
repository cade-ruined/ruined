"use client";

import Image from "next/image";
import { useState } from "react";

import { operatorMemberPhotoUrl } from "@/lib/membership/photo-policy";

/** Decorative beside a visible member name; never substitutes a made-up person. */
export default function OperatorMemberAvatar({ memberId, className = "h-10 w-10" }: {
  memberId: string;
  className?: string;
}) {
  const src = operatorMemberPhotoUrl(memberId);
  const [failedSource, setFailedSource] = useState<string | null>(null);

  return (
    <span aria-hidden="true" className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-black/[0.06] text-black/40 ${className}`} data-operator-member-avatar>
      <svg className="h-[62%] w-[62%]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" focusable="false">
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 21v-2a7 7 0 0 1 14 0v2" strokeLinecap="round" />
      </svg>
      {src && failedSource !== src ? (
        <Image alt="" className="object-cover" fill onError={() => setFailedSource(src)} sizes="48px" src={src} unoptimized />
      ) : null}
    </span>
  );
}
