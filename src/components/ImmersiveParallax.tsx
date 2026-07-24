"use client";

import {
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import type { Product } from "@/data/products";
import {
  SEQUENCE_OPENING_FRAME,
  type SequenceManifest,
} from "@/data/sequences";

const DESKTOP_EXPERIENCE_QUERY =
  "(min-width: 768px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";
const TOUCH_CAPABLE_QUERY = "(any-pointer: coarse)";
const DESKTOP_JOURNEY_RETRY_BASE_MS = 400;
const DESKTOP_JOURNEY_RETRY_MAX_MS = 4_000;
const HOME_HASHES = new Set(["#top", "#store", "#work", "#about", "#events"]);

type DesktopJourneyProps = {
  products: Product[];
  manifest: SequenceManifest;
};

type ReadyDesktopJourney = {
  Component: ComponentType<DesktopJourneyProps>;
  manifest: SequenceManifest;
};

function desktopMediaQueries() {
  return [
    window.matchMedia(DESKTOP_EXPERIENCE_QUERY),
    window.matchMedia(TOUCH_CAPABLE_QUERY),
  ];
}

function subscribeToDesktopExperience(onStoreChange: () => void) {
  const media = desktopMediaQueries();
  media.forEach((query) => query.addEventListener("change", onStoreChange));
  return () => {
    media.forEach((query) => query.removeEventListener("change", onStoreChange));
  };
}

function getDesktopExperienceSnapshot() {
  const [desktop, touchCapable] = desktopMediaQueries();
  return desktop.matches && !touchCapable.matches;
}

function getServerDesktopExperienceSnapshot() {
  // Static portrait scenes are the resilient SSR baseline. Eligible desktops
  // enhance after hydration; touch and reduced-motion clients never import the
  // cinematic module or request its manifest.
  return false;
}

function isSequenceManifest(value: unknown): value is SequenceManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<SequenceManifest>;
  return (
    typeof manifest.version === "string" &&
    /^[a-f0-9]{12}$/.test(manifest.version) &&
    typeof manifest.total === "number" &&
    manifest.total > 0 &&
    Array.isArray(manifest.rooms) &&
    manifest.rooms.every(
      (room) =>
        room &&
        typeof room.id === "string" &&
        typeof room.count === "number" &&
        Array.isArray(room.files)
    )
  );
}

export default function ImmersiveParallax({
  products,
  fallback,
}: {
  products: Product[];
  fallback: ReactNode;
}) {
  const desktopEligible = useSyncExternalStore(
    subscribeToDesktopExperience,
    getDesktopExperienceSnapshot,
    getServerDesktopExperienceSnapshot
  );
  const [desktopJourney, setDesktopJourney] =
    useState<ReadyDesktopJourney | null>(null);
  const [desktopLoadAttempt, setDesktopLoadAttempt] = useState(0);

  useEffect(() => {
    if (!desktopEligible || desktopJourney) return;

    const controller = new AbortController();
    let active = true;
    let retryTimer: number | undefined;

    void Promise.all([
      import("@/components/DesktopImmersiveParallax").then(
        (module) => module.default
      ),
      fetch("/sequences/manifest.json", {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Sequence manifest returned ${response.status}`);
          }
          return response.json() as Promise<unknown>;
        })
        .then((manifest) => {
          if (!isSequenceManifest(manifest)) {
            throw new Error("Sequence manifest is invalid");
          }
          return manifest;
        }),
    ])
      .then(([Component, manifest]) => {
        if (active) {
          setDesktopLoadAttempt(0);
          setDesktopJourney({ Component, manifest });
        }
      })
      .catch((error: unknown) => {
        if (
          active &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          if (desktopLoadAttempt === 0) {
            console.warn(
              "Desktop journey temporarily unavailable; retrying",
              error
            );
          }
          const retryDelay = Math.min(
            DESKTOP_JOURNEY_RETRY_BASE_MS * 2 ** desktopLoadAttempt,
            DESKTOP_JOURNEY_RETRY_MAX_MS
          );
          retryTimer = window.setTimeout(() => {
            if (active) {
              setDesktopLoadAttempt((attempt) => attempt + 1);
            }
          }, retryDelay);
        }
      });

    return () => {
      active = false;
      controller.abort();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [desktopEligible, desktopJourney, desktopLoadAttempt]);

  const showDesktop = desktopEligible && desktopJourney !== null;

  useLayoutEffect(() => {
    if (!showDesktop && document.querySelector("[data-mobile-stage]")) return;
    const hash = window.location.hash;
    const targetId = HOME_HASHES.has(hash) ? hash.slice(1) : "top";
    const target = document.getElementById(targetId);
    if (target) {
      const root = document.documentElement;
      const previousInlineBehavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      target.scrollIntoView({ block: "start", behavior: "auto" });
      root.style.scrollBehavior = previousInlineBehavior;
    }

  }, [showDesktop]);

  useEffect(() => {
    // SiteHeader subscribes in a passive effect, so announce the server-rendered
    // mobile anchors (and any later desktop replacement) from the same phase.
    window.dispatchEvent(new Event("ruined:home-anchors-ready"));
  }, [showDesktop]);

  if (!showDesktop) {
    return (
      <>
        <style>{`
          .ruined-desktop-sequence-bootstrap {
            display: none;
          }

          @media (min-width: 768px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
            .ruined-responsive-static-journey {
              display: none;
            }

            .ruined-desktop-sequence-bootstrap {
              display: block;
              width: 100%;
              min-height: 100vh;
              min-height: 100svh;
              background-color: #000;
              background-image: url("${SEQUENCE_OPENING_FRAME}");
              background-position: center;
              background-repeat: no-repeat;
              background-size: cover;
            }
          }

          @media (any-pointer: coarse) {
            .ruined-responsive-static-journey {
              display: block;
            }

            .ruined-desktop-sequence-bootstrap {
              display: none;
            }
          }
        `}</style>
        <div className="ruined-responsive-static-journey">{fallback}</div>
        <section
          aria-label="Hero"
          className="ruined-desktop-sequence-bootstrap"
          data-sequence-bootstrap="lobby"
        >
          <h1 className="sr-only">
            Ruined — objects, garments, spaces, and projects after the fear
          </h1>
        </section>
      </>
    );
  }

  const { Component, manifest } = desktopJourney;
  return <Component products={products} manifest={manifest} />;
}
