"use client";

import { useEffect, useState } from "react";
import { RANCH_SALE_END, RANCH_SALE_START } from "./ranch-promotion.js";

/** A serialized catalog timestamp keeps SSR and hydration in agreement. */
export function usePromotionTime(asOf?: number): number {
  const [now, setNow] = useState(() => asOf ?? Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timers = [RANCH_SALE_START, RANCH_SALE_END].map(Date.parse)
      .filter((time) => time > Date.now())
      .map((time) => window.setTimeout(update, Math.min(time - Date.now() + 1, 2147483647)));
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return now;
}
