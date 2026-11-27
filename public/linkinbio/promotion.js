import { STORE_SALE_START, STORE_SALE_END, STORE_SALE_PERCENT, STORE_SALE_COPY } from "../store-promotion-config.js";

const money = (cents) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
}).format(cents / 100);

export function applyStorePromotion(doc, now = Date.now()) {
  const active = now >= Date.parse(STORE_SALE_START) && now < Date.parse(STORE_SALE_END);
  doc.querySelectorAll("[data-store-sale]").forEach((notice) => {
    notice.textContent = STORE_SALE_COPY;
    notice.hidden = !active;
  });
  doc.querySelectorAll("[data-regular-cents]").forEach((price) => {
    const regularCents = Number(price.dataset.regularCents);
    if (!Number.isInteger(regularCents) || regularCents <= 0) return;
    const saleCents = Math.round(regularCents * (100 - STORE_SALE_PERCENT) / 100);
    price.querySelector("[data-current-price]").textContent = money(active ? saleCents : regularCents);
    const regular = price.querySelector("[data-regular-price]");
    regular.textContent = money(regularCents);
    regular.hidden = !active;
  });
}

if (typeof document !== "undefined") {
  let timer;
  const refresh = () => {
    window.clearTimeout(timer);
    const now = Date.now();
    applyStorePromotion(document, now);
    const nextBoundary = [STORE_SALE_START, STORE_SALE_END].map(Date.parse).find((time) => time > now);
    if (nextBoundary) timer = window.setTimeout(refresh, Math.min(nextBoundary - now + 1, 2147483647));
  };
  refresh();
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);
}
