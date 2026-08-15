"use client";

import {
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import { EVENTS } from "@/data/events";
import { JourneyLobbyIndex } from "@/components/sequence/JourneyIndexes";
import { EXPLORE_ROOMS } from "@/data/navigation";
import {
  SEQUENCE_OPENING_FRAME,
  type SequenceManifest,
} from "@/data/sequences";
import {
  sequenceAssetFocalX,
  sequenceFocalBoxGeometry,
} from "@/utils/sequenceFraming";
import {
  DESKTOP_EXPERIENCE_QUERY,
  MOBILE_STAGE_QUERY,
  immersiveExperienceMediaQueries,
  isDesktopImmersiveExperience,
} from "@/utils/immersiveExperience";

const DESKTOP_JOURNEY_RETRY_BASE_MS = 400;
const DESKTOP_JOURNEY_RETRY_MAX_MS = 4_000;
const HOME_HASHES = new Set(["#top", "#store", "#work", "#about", "#events"]);
const OPENING_FOCAL_X = sequenceAssetFocalX(SEQUENCE_OPENING_FRAME);
const OPENING_FOCAL_GEOMETRY = sequenceFocalBoxGeometry(OPENING_FOCAL_X);

type DesktopJourneyProps = {
  manifest: SequenceManifest;
};

type ReadyDesktopJourney = {
  Component: ComponentType<DesktopJourneyProps>;
  manifest: SequenceManifest;
};

function desktopMediaQueries() {
  return immersiveExperienceMediaQueries();
}

function subscribeToDesktopExperience(onStoreChange: () => void) {
  const media = desktopMediaQueries();
  media.forEach((query) => query.addEventListener("change", onStoreChange));
  return () => {
    media.forEach((query) => query.removeEventListener("change", onStoreChange));
  };
}

function getDesktopExperienceSnapshot() {
  return isDesktopImmersiveExperience();
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
  fallback,
}: {
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

          @media ${DESKTOP_EXPERIENCE_QUERY} {
            .ruined-responsive-static-journey {
              display: none;
            }

            .ruined-desktop-sequence-bootstrap {
              display: block;
              position: relative;
              overflow: hidden;
              width: 100%;
              min-height: 100vh;
              min-height: 100svh;
              background-color: #000;
            }

            .ruined-desktop-sequence-bootstrap::before {
              content: "";
              position: ${OPENING_FOCAL_GEOMETRY.position};
              right: ${OPENING_FOCAL_GEOMETRY.right};
              bottom: ${OPENING_FOCAL_GEOMETRY.bottom};
              left: ${OPENING_FOCAL_GEOMETRY.left};
              top: ${OPENING_FOCAL_GEOMETRY.top};
              width: ${OPENING_FOCAL_GEOMETRY.width};
              height: ${OPENING_FOCAL_GEOMETRY.height};
              transform: ${OPENING_FOCAL_GEOMETRY.transform};
              background-image: url("${SEQUENCE_OPENING_FRAME}");
              background-position: ${OPENING_FOCAL_X * 100}% center;
              background-repeat: no-repeat;
              background-size: cover;
            }

            .ruined-desktop-sequence-bootstrap__index {
              position: absolute;
              right: 1rem;
              bottom: calc(env(safe-area-inset-bottom, 0px) + 3.5rem);
              left: 1rem;
              z-index: 1;
              width: min(calc(100% - 2rem), 56rem);
              margin-inline: auto;
            }
          }

          /* Compact hybrid devices can report a fine primary pointer while a
             touchscreen remains available. The stage query wins so an iPad
             never receives the desktop bootstrap or falls through to pages. */
          @media ${MOBILE_STAGE_QUERY} {
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
          <div className="ruined-desktop-sequence-bootstrap__index">
            <h2 className="sr-only">{EXPLORE_ROOMS[0].headline}</h2>
            <JourneyLobbyIndex
              events={EVENTS}
            />
          </div>
        </section>
      </>
    );
  }

  const { Component, manifest } = desktopJourney;
  return <Component manifest={manifest} />;
}
