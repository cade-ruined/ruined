"use client";

import { useSelectedLayoutSegments } from "next/navigation";

export function useBackgroundPathname(): string {
  const segments = useSelectedLayoutSegments("children").filter(
    (segment) => !segment.startsWith("("),
  );

  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}
