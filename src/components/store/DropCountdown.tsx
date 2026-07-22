"use client";

import { useEffect, useMemo, useState } from "react";

export default function DropCountdown({ endsAt }: { endsAt?: string }) {
  const end = useMemo(() => (endsAt ? new Date(endsAt).getTime() : 0), [endsAt]);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!end || Number.isNaN(end)) return;
    const update = () => setRemaining(Math.max(0, end - Date.now()));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [end]);

  if (!endsAt || !end || Number.isNaN(end)) {
    return (
      <div className="flex items-center justify-between gap-4 font-mono text-[0.54rem] uppercase tracking-[0.24em]">
        <span className="text-white/40">Release window</span>
        <span className="text-[var(--color-poster)]">Open now</span>
      </div>
    );
  }

  const value = remaining === null ? "--:--:--:--" : formatRemaining(remaining);
  return (
    <div className="flex items-center justify-between gap-4 font-mono text-[0.54rem] uppercase tracking-[0.2em]">
      <span className="text-white/40">Purchase window</span>
      <span className="tabular-nums text-[var(--color-poster)]" aria-live="off">
        {remaining === 0 ? "Window closed" : value}
      </span>
    </div>
  );
}

function formatRemaining(milliseconds: number) {
  const total = Math.floor(milliseconds / 1000);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [days, hours, minutes, seconds]
    .map((value, index) => String(value).padStart(index === 0 ? 2 : 2, "0"))
    .join(":");
}
