"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProductOptionValue } from "@/data/products";

const STORAGE_KEY = "ruined:bag:v1";
const CHANGE_EVENT = "ruined:bag-change";
const MAX_QUANTITY = 20;

export type BagItem = {
  key: string;
  productId: string;
  productName: string;
  productCode: string;
  variantId: string;
  variantTitle: string;
  selectedOptions: ProductOptionValue[];
  unitPrice: string;
  priceAmount: string;
  currencyCode: string;
  image?: { url: string; alt: string };
  expectedShipDate?: string;
  quantity: number;
};

export type NewBagItem = Omit<BagItem, "key" | "quantity"> & {
  quantity?: number;
};

export function isShopifyVariantId(id: string): boolean {
  return /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(id);
}

function clampQuantity(quantity: number): number {
  return Math.min(MAX_QUANTITY, Math.max(1, Math.floor(quantity)));
}

function isOptionValue(value: unknown): value is ProductOptionValue {
  if (!value || typeof value !== "object") return false;
  const option = value as Record<string, unknown>;
  return typeof option.name === "string" && typeof option.value === "string";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isBagItem(value: unknown): value is BagItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.key === "string" &&
    typeof item.productId === "string" &&
    typeof item.productName === "string" &&
    typeof item.productCode === "string" &&
    typeof item.variantId === "string" &&
    typeof item.variantTitle === "string" &&
    Array.isArray(item.selectedOptions) &&
    item.selectedOptions.every(isOptionValue) &&
    typeof item.unitPrice === "string" &&
    typeof item.priceAmount === "string" &&
    typeof item.currencyCode === "string" &&
    isOptionalString(item.expectedShipDate) &&
    typeof item.quantity === "number"
  );
}

function bagItemKey(productId: string, variantId: string): string {
  return `${productId}::${variantId}`;
}

function readBag(): BagItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed.filter(isBagItem).map((item) => ({
      key: bagItemKey(item.productId, item.variantId),
      productId: item.productId,
      productName: item.productName,
      productCode: item.productCode,
      variantId: item.variantId,
      variantTitle: item.variantTitle,
      selectedOptions: item.selectedOptions,
      unitPrice: item.unitPrice,
      priceAmount: item.priceAmount,
      currencyCode: item.currencyCode,
      image: item.image,
      expectedShipDate: item.expectedShipDate,
      quantity: clampQuantity(item.quantity),
    }));
    const consolidated = new Map<string, BagItem>();
    for (const item of normalized) {
      const existing = consolidated.get(item.key);
      consolidated.set(
        item.key,
        existing
          ? {
              ...existing,
              expectedShipDate: item.expectedShipDate ?? existing.expectedShipDate,
              quantity: clampQuantity(existing.quantity + item.quantity),
            }
          : item
      );
    }
    return Array.from(consolidated.values());
  } catch {
    return [];
  }
}

function writeBag(items: BagItem[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function mutateBag(update: (items: BagItem[]) => BagItem[]) {
  writeBag(update(readBag()));
}

export function addBagItem(item: NewBagItem) {
  const key = bagItemKey(item.productId, item.variantId);
  mutateBag((items) => {
    const existing = items.find((line) => line.key === key);
    if (existing) {
      return items.map((line) =>
        line.key === key
          ? {
              ...line,
              expectedShipDate: item.expectedShipDate ?? line.expectedShipDate,
              quantity: clampQuantity(line.quantity + (item.quantity ?? 1)),
            }
          : line
      );
    }
    return [...items, { ...item, key, quantity: clampQuantity(item.quantity ?? 1) }];
  });
}

export function useBag() {
  const [items, setItems] = useState<BagItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const refresh = () => setItems(readBag());
    refresh();
    setHydrated(true);
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const add = useCallback((item: NewBagItem) => addBagItem(item), []);
  const setQuantity = useCallback((key: string, quantity: number) => {
    mutateBag((current) =>
      current.map((item) =>
        item.key === key ? { ...item, quantity: clampQuantity(quantity) } : item
      )
    );
  }, []);
  const remove = useCallback((key: string) => {
    mutateBag((current) => current.filter((item) => item.key !== key));
  }, []);
  const clear = useCallback(() => writeBag([]), []);
  const count = useMemo(
    () => items.reduce((total, item) => total + item.quantity, 0),
    [items]
  );

  return { items, count, hydrated, add, setQuantity, remove, clear };
}
