"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import type {
  MembershipAddressSuggestion,
  MembershipResolvedAddress,
} from "@/lib/membership/address-lookup";
import {
  SHIPPING_COUNTRY_OPTIONS,
  supportedShippingCountry,
} from "@/lib/membership/phone";

type LookupResponse = {
  address?: MembershipResolvedAddress;
  error?: string;
  suggestions?: MembershipAddressSuggestion[];
};

type AddressFieldsState = MembershipResolvedAddress & {
  addressLine2: string;
};

function initialString(value: Record<string, unknown> | null, key: string) {
  return value && typeof value[key] === "string" ? String(value[key]) : "";
}

function manualEntryMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  return /enter (?:it|your address) manually/i.test(message)
    ? message
    : `${message} Enter your address manually.`;
}

export default function AddressFields({
  addressLookupEnabled,
  fieldClass,
  fieldLabelClass,
  fieldLabelTextClass,
  initialAddress,
}: {
  addressLookupEnabled: boolean;
  fieldClass: string;
  fieldLabelClass: string;
  fieldLabelTextClass: string;
  initialAddress: Record<string, unknown> | null;
}) {
  const listId = useId();
  const helperId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const suppressNextSearch = useRef(false);
  const [fields, setFields] = useState<AddressFieldsState>(() => ({
    addressLine1: initialString(initialAddress, "addressLine1"),
    addressLine2: initialString(initialAddress, "addressLine2"),
    city: initialString(initialAddress, "city"),
    countryCode:
      supportedShippingCountry(initialString(initialAddress, "countryCode")) ?? "US",
    postalCode: initialString(initialAddress, "postalCode"),
    region: initialString(initialAddress, "region"),
  }));
  const [showAddressFields, setShowAddressFields] = useState(
    !addressLookupEnabled || Boolean(initialString(initialAddress, "addressLine1")),
  );
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<MembershipAddressSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [lookupState, setLookupState] = useState<
    "idle" | "loading" | "results" | "empty" | "resolving" | "selected" | "error"
  >("idle");
  const [lookupMessage, setLookupMessage] = useState(
    "Choose a result to fill the details below.",
  );

  const panelVisible =
    addressLookupEnabled &&
    ["loading", "results", "empty", "resolving"].includes(lookupState);
  const listVisible =
    addressLookupEnabled && lookupState === "results" && suggestions.length > 0;

  useEffect(() => {
    if (activeIndex < 0) return;
    document
      .getElementById(`${listId}-option-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listId]);

  useEffect(() => {
    const closeFromOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setSuggestions([]);
        setActiveIndex(-1);
        setLookupState((current) =>
          current === "results" || current === "empty" ? "idle" : current,
        );
      }
    };
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, []);

  useEffect(() => {
    if (!addressLookupEnabled) return;
    requestRef.current?.abort();
    if (suppressNextSearch.current) {
      suppressNextSearch.current = false;
      return;
    }
    const input = query.trim();
    if (input.length < 3) {
      setSuggestions([]);
      setActiveIndex(-1);
      setLookupState("idle");
      setLookupMessage("Choose a result to fill the details below.");
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    const timer = window.setTimeout(async () => {
      setLookupState("loading");
      setLookupMessage("Looking up addresses…");
      sessionTokenRef.current ??= crypto.randomUUID();
      try {
        const response = await fetch("/api/my/address-lookup", {
          body: JSON.stringify({
            action: "suggest",
            input,
            regionCode: fields.countryCode,
            sessionToken: sessionTokenRef.current,
          }),
          cache: "no-store",
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: controller.signal,
        });
        const payload = (await response.json()) as LookupResponse;
        if (!response.ok || !payload.suggestions) {
          throw new Error(payload.error || "Address lookup is unavailable.");
        }
        if (controller.signal.aborted) return;
        setSuggestions(payload.suggestions);
        setActiveIndex(payload.suggestions.length ? 0 : -1);
        setLookupState(payload.suggestions.length ? "results" : "empty");
        setLookupMessage(
          payload.suggestions.length
            ? `${payload.suggestions.length} address${payload.suggestions.length === 1 ? "" : "es"} found.`
            : "No matching address. Try including a city or postal code.",
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setSuggestions([]);
        setActiveIndex(-1);
        setShowAddressFields(true);
        setLookupState("error");
        setLookupMessage(
          manualEntryMessage(error, "Address lookup is unavailable."),
        );
      }
    }, 275);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [addressLookupEnabled, fields.countryCode, query]);

  const updateField =
    (key: keyof AddressFieldsState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = event.currentTarget.value;
      if (key === "countryCode") {
        requestRef.current?.abort();
        sessionTokenRef.current = null;
        setSuggestions([]);
        setActiveIndex(-1);
        setLookupState("idle");
        setLookupMessage("Choose a result to fill the details below.");
      }
      setFields((current) => ({ ...current, [key]: value }));
    };

  async function chooseSuggestion(suggestion: MembershipAddressSuggestion) {
    if (!sessionTokenRef.current || lookupState === "resolving") return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setSuggestions([]);
    setActiveIndex(-1);
    setLookupState("resolving");
    setLookupMessage("Filling the address…");
    try {
      const response = await fetch("/api/my/address-lookup", {
        body: JSON.stringify({
          action: "resolve",
          placeId: suggestion.id,
          sessionToken: sessionTokenRef.current,
        }),
        cache: "no-store",
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: controller.signal,
      });
      const payload = (await response.json()) as LookupResponse;
      if (controller.signal.aborted) return;
      if (!response.ok || !payload.address) {
        throw new Error(payload.error || "That address could not be filled.");
      }
      const countryCode = supportedShippingCountry(payload.address.countryCode);
      if (!countryCode) throw new Error("That address uses an unsupported country code.");
      const nextFields = {
        ...payload.address,
        countryCode,
      };
      setFields(nextFields);
      inputRef.current?.setCustomValidity("");
      setShowAddressFields(true);
      suppressNextSearch.current = true;
      setQuery(
        [suggestion.mainText, suggestion.secondaryText].filter(Boolean).join(", "),
      );
      setLookupState("selected");
      const incomplete = [
        nextFields.addressLine1,
        nextFields.city,
        nextFields.region,
        nextFields.postalCode,
      ].some((value) => !value);
      setLookupMessage(
        incomplete
          ? "Address found. Add the missing details below."
          : "Address found. Review the details below.",
      );
      sessionTokenRef.current = null;
    } catch (error) {
      if (controller.signal.aborted) return;
      setShowAddressFields(true);
      setLookupState("error");
      setLookupMessage(
        manualEntryMessage(error, "Address lookup is unavailable."),
      );
      sessionTokenRef.current = null;
    }
  }

  function handleLookupKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      setActiveIndex((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        void chooseSuggestion(suggestions[activeIndex]);
      }
      return;
    }
    if (event.key === "Escape") {
      setSuggestions([]);
      setActiveIndex(-1);
      setLookupState("idle");
      return;
    }
    if (event.key === "Tab") {
      setSuggestions([]);
      setActiveIndex(-1);
      setLookupState("idle");
    }
  }

  return (
    <fieldset className="grid gap-5 sm:grid-cols-2">
      <legend className={`${fieldLabelTextClass} mb-5 text-[1.65rem]`}>
        Shipping address
      </legend>

      <label className={`${fieldLabelClass} sm:col-span-2 sm:max-w-sm`} htmlFor="shipping-country">
        <span className={fieldLabelTextClass}>Country</span>
        <select
          autoComplete="off"
          className={fieldClass}
          id="shipping-country"
          name="country-code"
          onChange={updateField("countryCode")}
          required
          value={fields.countryCode}
        >
          {SHIPPING_COUNTRY_OPTIONS.map((country) => (
            <option className="text-black" key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </select>
      </label>

      {addressLookupEnabled ? (
        <div className="relative sm:col-span-2" ref={rootRef}>
          <label className={fieldLabelClass} htmlFor="shipping-address-search">
            <span className={fieldLabelTextClass}>Find your address</span>
            <input
              aria-activedescendant={
                listVisible && activeIndex >= 0
                  ? `${listId}-option-${activeIndex}`
                  : undefined
              }
              aria-autocomplete="list"
              aria-controls={listVisible ? listId : undefined}
              aria-describedby={helperId}
              aria-expanded={listVisible}
              autoCapitalize="words"
              autoComplete="off"
              autoCorrect="off"
              className={`${fieldClass} text-base sm:text-sm`}
              enterKeyHint="search"
              id="shipping-address-search"
              onChange={(event) => {
                requestRef.current?.abort();
                event.currentTarget.setCustomValidity("");
                setSuggestions([]);
                setQuery(event.currentTarget.value);
                setActiveIndex(-1);
                setLookupState("idle");
              }}
              onKeyDown={handleLookupKeyDown}
              placeholder="Start typing a street address"
              ref={inputRef}
              role="combobox"
              spellCheck={false}
              type="search"
              value={query}
            />
          </label>

          {panelVisible ? (
            <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-[4px] border border-white/18 bg-[#0d0a09] shadow-2xl shadow-black/50">
              {lookupState === "loading" || lookupState === "resolving" ? (
                <p className="px-4 py-4 font-[var(--font-body)] text-sm text-white/48">
                  {lookupState === "loading" ? "Looking up addresses…" : "Filling the address…"}
                </p>
              ) : null}
              {lookupState === "empty" ? (
                <p className="px-4 py-4 font-[var(--font-body)] text-sm text-white/52">
                  No matching address. Try including a city or postal code.
                </p>
              ) : null}
              {lookupState === "results" ? (
                <ul
                  className="max-h-[min(18rem,40dvh)] overflow-y-auto"
                  id={listId}
                  role="listbox"
                >
                  {suggestions.map((suggestion, index) => (
                    <li
                      aria-selected={index === activeIndex}
                      className={`flex min-h-12 cursor-pointer flex-col justify-center px-4 py-3 text-left font-[var(--font-body)] transition-colors hover:bg-white/[0.045] ${
                        index === activeIndex
                          ? "bg-[var(--color-poster)]/14"
                          : ""
                      }`}
                      id={`${listId}-option-${index}`}
                      key={suggestion.id}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        void chooseSuggestion(suggestion);
                      }}
                      role="option"
                    >
                      <span className="text-sm text-white/88">{suggestion.mainText}</span>
                      {suggestion.secondaryText ? (
                        <span className="mt-1 text-xs leading-relaxed text-white/42">
                          {suggestion.secondaryText}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {lookupState === "results" ? (
                <div className="flex justify-end border-t border-white/10 bg-white px-2 py-1.5">
                  {/* Google requires this official attribution beside autocomplete predictions. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt="Powered by Google"
                    className="h-[18px] w-auto"
                    src="/powered-by-google-on-white.png"
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
            <p
              aria-live="polite"
              className={`font-[var(--font-body)] text-xs leading-relaxed ${
                lookupState === "error" ? "text-[var(--color-poster)]" : "text-white/42"
              }`}
              id={helperId}
            >
              {lookupMessage}
            </p>
            {!showAddressFields ? (
              <button
                className="font-[var(--font-body)] text-xs text-white/62 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white"
                onClick={() => {
                  inputRef.current?.setCustomValidity("");
                  setShowAddressFields(true);
                  setLookupState("idle");
                  setLookupMessage("Enter the address details below.");
                }}
                type="button"
              >
                Enter address manually
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {showAddressFields ? (
        <>
          <label className={`${fieldLabelClass} sm:col-span-2`} htmlFor="shipping-address-line-1">
            <span className={fieldLabelTextClass}>Street address</span>
            <input
              autoCapitalize="words"
              autoComplete="off"
              autoCorrect="off"
              className={fieldClass}
              id="shipping-address-line-1"
              name="address-line-1"
              onChange={updateField("addressLine1")}
              required
              spellCheck={false}
              value={fields.addressLine1}
            />
          </label>
          <label className={`${fieldLabelClass} sm:col-span-2`} htmlFor="shipping-address-line-2">
            <span className={fieldLabelTextClass}>Apartment, suite, etc. / Optional</span>
            <input
              autoCapitalize="words"
              autoComplete="off"
              autoCorrect="off"
              className={fieldClass}
              id="shipping-address-line-2"
              name="address-line-2"
              onChange={updateField("addressLine2")}
              spellCheck={false}
              value={fields.addressLine2}
            />
          </label>
          <label className={fieldLabelClass} htmlFor="shipping-city">
            <span className={fieldLabelTextClass}>City</span>
            <input
              autoCapitalize="words"
              autoComplete="off"
              autoCorrect="off"
              className={fieldClass}
              id="shipping-city"
              name="city"
              onChange={updateField("city")}
              required
              spellCheck={false}
              value={fields.city}
            />
          </label>
          <label className={fieldLabelClass} htmlFor="shipping-region">
            <span className={fieldLabelTextClass}>State or region</span>
            <input
              autoCapitalize="words"
              autoComplete="off"
              autoCorrect="off"
              className={fieldClass}
              id="shipping-region"
              name="region"
              onChange={updateField("region")}
              required
              spellCheck={false}
              value={fields.region}
            />
          </label>
          <label className={fieldLabelClass} htmlFor="shipping-postal-code">
            <span className={fieldLabelTextClass}>Postal code</span>
            <input
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              className={fieldClass}
              id="shipping-postal-code"
              name="postal-code"
              onChange={updateField("postalCode")}
              required
              spellCheck={false}
              value={fields.postalCode}
            />
          </label>
        </>
      ) : null}
    </fieldset>
  );
}
