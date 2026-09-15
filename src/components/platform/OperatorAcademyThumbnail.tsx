"use client";

import Image from "next/image";
import { useState } from "react";

export default function OperatorAcademyThumbnail({ src, format, detail = false }: {
  src?: string | null;
  format: string;
  detail?: boolean;
}) {
  const source = src?.trim() || null;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const available = source && failedSource !== source;
  return <span aria-hidden="true" className={`relative flex shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-[6px] bg-black/[0.055] text-black/45 ${detail ? "my-3 h-20 w-full" : "size-16"}`}>
    <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" focusable="false">
      {format === "video" ? <path d="m9 5 11 7-11 7V5Z" /> : format === "audio" ? <><path d="M5 14v-2a7 7 0 0 1 14 0v2" /><rect x="3" y="12" width="4" height="7" rx="2" /><rect x="17" y="12" width="4" height="7" rx="2" /></> : <><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v5h4M9 12h6M9 16h6" /></>}
    </svg>
    <span className="text-[0.65rem] capitalize">{format || "Lesson"}</span>
    {available ? <Image key={source} src={source} alt="" fill unoptimized sizes={detail ? "(max-width: 767px) 100vw, 400px" : "64px"} className={`object-cover transition-opacity ${loadedSource === source ? "opacity-100" : "opacity-0"}`} onLoad={() => setLoadedSource(source)} onError={() => setFailedSource(source)} /> : null}
  </span>;
}
