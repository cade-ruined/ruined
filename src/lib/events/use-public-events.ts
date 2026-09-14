"use client";

import { useEffect, useState } from "react";
import type { StudioEvent } from "@/data/events";

let pending: Promise<StudioEvent[]> | null = null;
function loadEvents() {
  if (!pending) pending = fetch("/api/community/events", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Events unavailable");
      const body = await response.json();
      return Array.isArray(body.events) ? body.events as StudioEvent[] : [];
    })
    .catch(() => [])
    .finally(() => { pending = null; });
  return pending;
}

/** Empty until the public feed confirms visibility; never revive archived defaults. */
export function usePublicEvents(initialEvents: StudioEvent[] = []) {
  const [events, setEvents] = useState(initialEvents);
  useEffect(() => {
    let current = true;
    void loadEvents().then((next) => { if (current) setEvents(next); });
    return () => { current = false; };
  }, []);
  return events;
}
