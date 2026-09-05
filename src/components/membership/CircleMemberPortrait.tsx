import Image from "next/image";
import type { CSSProperties } from "react";

import type { PrivacySafePersonSummary } from "@/lib/membership/model";

const PREVIEW_PORTRAIT_COUNT = 10;

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function previewCirclePortraitIndex(personId: string) {
  if (personId === "preview-directory-self") return 0;

  const match = personId.match(/^preview-directory-(\d{2})$/);
  if (!match) return null;

  const index = Number(match[1]) - 1;
  return index >= 0 && index < PREVIEW_PORTRAIT_COUNT ? index : null;
}

function previewCirclePortraitStyle(personId: string): CSSProperties | null {
  const index = previewCirclePortraitIndex(personId);
  if (index === null) return null;

  const column = index % 5;
  const row = Math.floor(index / 5);
  return {
    backgroundImage: 'url("/membership/circle-preview-portraits.webp")',
    backgroundPosition: `${column * 25}% ${row === 0 ? 6 : 76}%`,
    backgroundSize: "500% auto",
  };
}

export default function CircleMemberPortrait({
  imageClassName,
  imageSizes,
  initialsClassName,
  person,
  previewClassName,
  priority = false,
}: {
  imageClassName: string;
  imageSizes: string;
  initialsClassName: string;
  person: PrivacySafePersonSummary;
  previewClassName: string;
  priority?: boolean;
}) {
  if (person.avatarUrl) {
    return (
      <Image
        alt=""
        aria-hidden="true"
        className={imageClassName}
        fill
        priority={priority}
        sizes={imageSizes}
        src={person.avatarUrl}
        unoptimized
      />
    );
  }

  const previewStyle = previewCirclePortraitStyle(person.id);
  if (previewStyle) {
    return <span aria-hidden="true" className={previewClassName} style={previewStyle} />;
  }

  return (
    <span aria-hidden="true" className={initialsClassName}>
      {initials(person.displayName) || "R"}
    </span>
  );
}
