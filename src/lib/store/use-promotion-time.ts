"use client";

import { useEffect, useState } from "react";
import { STORE_SALE_END, STORE_SALE_START } from "./store-promotion.js";

/** A serialized catalog timestamp keeps SSR and hydration in agreement. */
export function usePromotionTime(asOf?: number): number {
  const [now, setNow] = useState(() => asOf ?? Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timers = [STORE_SALE_START, STORE_SALE_END].map(Date.parse)
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
