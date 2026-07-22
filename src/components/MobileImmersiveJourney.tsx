"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { versionSequenceAsset } from "@/data/sequences";

type MobileScene = {
  id: "top" | "store" | "work" | "about";
  href: "#store" | `/${"store" | "work" | "about"}`;
  image: string;
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
};

const MOBILE_SCENES = [
  {
    id: "top",
    href: "#store",
    image: versionSequenceAsset("/sequences/lobby/frame-0001.webp"),
    eyebrow: "The Ruined Project",
    title: "Enter Ruined",
    description: "Objects, garments, spaces, and projects after the fear.",
    cta: "Begin the walk",
  },
  {
    id: "store",
    href: "/store",
    image: versionSequenceAsset("/sequences/lobby/frame-0192.webp"),
    eyebrow: "01 / Artifacts",
    title: "The Store",
    description: "Objects and garments made to gather a history.",
    cta: "Enter the store",
  },
  {
    id: "work",
    href: "/work",
    image: versionSequenceAsset("/sequences/store/frame-0192.webp"),
    eyebrow: "02 / Project Hub",
    title: "The Work",
    description: "Objects, spaces, and material records from the studio.",
    cta: "Open the project hub",
  },
  {
    id: "about",
    href: "/about",
    image: versionSequenceAsset("/sequences/records/frame-0192.webp"),
    eyebrow: "03 / Studio No. 17",
    title: "What Remains",
    description: "A practice shaped by use, wear, place, and what survives.",
    cta: "About the studio",
  },
] as const satisfies readonly MobileScene[];

function MobileRoomScene({
  scene,
  priority,
}: {
  scene: MobileScene;
  priority: boolean;
}) {
  const headingId = `mobile-${scene.id}-heading`;

  return (
    <article
      id={scene.id}
      data-scene-id={scene.id}
      data-mobile-snap-scene
      aria-labelledby={headingId}
      className="ruined-mobile-scene"
    >
      <div className="ruined-mobile-scene__visual">
        <div className="ruined-mobile-scene__media">
          <Image
            src={scene.image}
            alt=""
            fill
            sizes="100vw"
            priority={priority}
            unoptimized
            draggable={false}
            className="ruined-mobile-scene__image"
          />
        </div>
        <div className="ruined-mobile-scene__scrim" aria-hidden="true" />
        <div className="ruined-mobile-scene__copy">
          <p className="ruined-mobile-scene__eyebrow">{scene.eyebrow}</p>
          <h2 id={headingId} className="ruined-mobile-scene__title">
            {scene.title}
          </h2>
          <p className="ruined-mobile-scene__description">
            {scene.description}
          </p>
          <Link className="ruined-mobile-scene__link" href={scene.href}>
            <span>{scene.cta}</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </article>
  );
}

/**
 * Native one-viewport snap points provide a feed-like interaction: every card
 * owns one approved sequence frame and slides as a complete viewport. There is
 * no canvas, frame scrubbing, scroll spring, zoom, or smoothing layer.
 */
export default function MobileImmersiveJourney() {
  const journeyRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.documentElement.classList.add("ruined-mobile-snap-active");
    return () => {
      document.documentElement.classList.remove("ruined-mobile-snap-active");
    };
  }, []);

  return (
    <section
      ref={journeyRef}
      data-journey="mobile"
      aria-labelledby="mobile-journey-heading"
      className="ruined-mobile-journey"
    >
      <h1 id="mobile-journey-heading" className="sr-only">
        Ruined — objects, garments, spaces, and projects after the fear
      </h1>

      {MOBILE_SCENES.map((scene, index) => (
        <MobileRoomScene
          key={scene.id}
          scene={scene}
          priority={index === 0}
        />
      ))}

      <section
        id="events"
        data-scene-id="events"
        data-mobile-snap-scene
        aria-labelledby="mobile-fear-heading"
        className="ruined-mobile-closing"
      >
        <div className="ruined-mobile-closing__media" aria-hidden="true">
          <Image
            src={versionSequenceAsset("/sequences/lounge/frame-0192.webp")}
            alt=""
            fill
            sizes="100vw"
            unoptimized
            draggable={false}
            className="ruined-mobile-scene__image"
          />
        </div>
        <div className="ruined-mobile-closing__inner">
          <p className="ruined-mobile-closing__registration">RU // AW26</p>
          <h2 id="mobile-fear-heading" className="ruined-mobile-closing__title">
            <span>After</span>
            <span>The</span>
            <span className="ruined-mobile-closing__fear">Fear</span>
          </h2>

          <div className="ruined-mobile-closing__footer">
            <div className="ruined-mobile-closing__rule" aria-hidden="true">
              <span>⊕</span>
              <span />
              <span>⊕</span>
            </div>
            <div className="ruined-mobile-closing__credit">
              <span>© 2026 The Ruined Project</span>
              <span>40.4633° N / 111.7780° W</span>
            </div>
            <Link className="ruined-mobile-closing__events-link" href="/events">
              <span>View the studio programme</span>
              <span aria-hidden="true">→</span>
            </Link>
            <nav
              aria-label="Explore after the journey"
              className="ruined-mobile-closing__nav"
            >
              <Link href="/store">Store</Link>
              <Link href="/work">Work</Link>
              <Link href="/events">Events</Link>
              <Link href="/about">About</Link>
              <a href="#top">Walk again ↺</a>
            </nav>
          </div>
        </div>
      </section>

      <style>{`
        @media (max-width: 767px) and (prefers-reduced-motion: no-preference),
          (any-pointer: coarse) and (prefers-reduced-motion: no-preference) {
          html.ruined-mobile-snap-active {
            scroll-behavior: auto;
            scroll-snap-type: y mandatory;
            scroll-padding-block: 0;
            overscroll-behavior-y: contain;
          }
        }

        .ruined-mobile-journey {
          position: relative;
          display: block;
          overflow: clip;
          isolation: isolate;
          background: #080605;
          color: var(--color-bone, #e5e0d5);
          touch-action: pan-y;
        }

        .ruined-mobile-scene__media,
        .ruined-mobile-closing__media {
          position: absolute;
          inset: 0;
          z-index: -2;
          background-color: #080605;
          overflow: hidden;
        }

        .ruined-mobile-scene__image {
          object-fit: cover;
          object-position: center;
          user-select: none;
        }

        .ruined-mobile-scene,
        .ruined-mobile-closing {
          position: relative;
          z-index: 1;
          height: 100vh;
          min-height: 100vh;
          margin: 0;
          scroll-snap-align: start;
          scroll-snap-stop: always;
          scroll-margin-block: 0;
        }

        .ruined-mobile-scene__visual {
          position: relative;
          height: 100%;
          overflow: hidden;
          isolation: isolate;
        }

        .ruined-mobile-scene__scrim {
          position: absolute;
          inset: 0;
          z-index: -1;
          background:
            linear-gradient(to bottom, rgba(8, 6, 5, 0.24) 0%, transparent 34%),
            linear-gradient(to top, rgba(8, 6, 5, 0.96) 0%, rgba(8, 6, 5, 0.54) 34%, transparent 68%);
          pointer-events: none;
        }

        .ruined-mobile-scene__copy {
          position: absolute;
          inset-inline: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          padding:
            1.25rem
            max(1.25rem, env(safe-area-inset-right, 0px))
            calc(env(safe-area-inset-bottom, 0px) + 5.75rem)
            max(1.25rem, env(safe-area-inset-left, 0px));
        }

        .ruined-mobile-scene__eyebrow,
        .ruined-mobile-closing__registration {
          margin: 0 0 0.65rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.56rem;
          line-height: 1;
          letter-spacing: 0.28em;
          text-transform: uppercase;
          color: color-mix(in srgb, var(--color-bone, #e5e0d5) 68%, transparent);
        }

        .ruined-mobile-scene__title {
          max-width: 8ch;
          margin: 0;
          font-family: var(--font-header, Inter, sans-serif) !important;
          font-size: clamp(2.5rem, 12vw, 4.5rem);
          font-weight: var(--weight-header, 700) !important;
          line-height: 0.86;
          letter-spacing: -0.055em;
          text-transform: uppercase;
          text-wrap: balance;
          color: var(--color-bone, #e5e0d5);
          text-shadow: 0 2px 20px rgba(0, 0, 0, 0.35);
        }

        .ruined-mobile-scene__description {
          max-width: 28rem;
          margin: 0.9rem 0 1rem;
          font-size: 0.82rem;
          line-height: 1.5;
          color: color-mix(in srgb, var(--color-bone, #e5e0d5) 76%, transparent);
        }

        .ruined-mobile-scene__link,
        .ruined-mobile-closing__events-link {
          display: inline-flex;
          min-height: 2.75rem;
          align-items: center;
          justify-content: space-between;
          gap: 1.5rem;
          border: 1.5px solid var(--color-bone, #e5e0d5);
          padding: 0.75rem 0.9rem;
          background: color-mix(in srgb, #080605 78%, transparent);
          color: var(--color-bone, #e5e0d5);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.56rem;
          line-height: 1;
          letter-spacing: 0.16em;
          text-decoration: none;
          text-transform: uppercase;
          box-shadow: 4px 4px 0 var(--color-poster, #d0312d);
          -webkit-tap-highlight-color: transparent;
        }

        .ruined-mobile-scene__link:active {
          transform: translate3d(2px, 2px, 0);
          box-shadow: 2px 2px 0 var(--color-poster, #d0312d);
        }

        .ruined-mobile-closing {
          background: linear-gradient(to bottom, rgba(8, 6, 5, 0.72), #080605 58%);
        }

        .ruined-mobile-closing__inner {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding:
            max(5rem, env(safe-area-inset-top, 0px))
            max(1.25rem, env(safe-area-inset-right, 0px))
            calc(env(safe-area-inset-bottom, 0px) + 5.75rem)
            max(1.25rem, env(safe-area-inset-left, 0px));
        }

        .ruined-mobile-closing__registration {
          margin-bottom: 1.25rem;
          color: var(--color-signal, #e5a923);
        }

        .ruined-mobile-closing__title {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin: 0;
          font-family: var(--font-header, Inter, sans-serif) !important;
          font-size: clamp(3.5rem, 18vw, 6rem);
          font-weight: var(--weight-header, 700) !important;
          line-height: 0.79;
          letter-spacing: -0.06em;
          text-transform: uppercase;
          color: var(--color-bone, #e5e0d5);
        }

        .ruined-mobile-closing__fear {
          font-family: var(--font-display, Georgia, serif) !important;
          font-style: italic;
          color: var(--color-signal, #e5a923);
        }

        .ruined-mobile-closing__footer {
          width: 100%;
          margin-top: auto;
          padding-top: 3rem;
        }

        .ruined-mobile-closing__rule {
          display: grid;
          grid-template-columns: auto 1fr auto;
          align-items: center;
          gap: 0.75rem;
          color: color-mix(in srgb, var(--color-bone, #e5e0d5) 42%, transparent);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.6rem;
        }

        .ruined-mobile-closing__rule > span:nth-child(2) {
          height: 1px;
          background: color-mix(in srgb, var(--color-bone, #e5e0d5) 20%, transparent);
        }

        .ruined-mobile-closing__credit {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          margin-top: 0.75rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.46rem;
          line-height: 1.5;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: color-mix(in srgb, var(--color-bone, #e5e0d5) 48%, transparent);
        }

        .ruined-mobile-closing__credit > span:last-child {
          text-align: right;
        }

        .ruined-mobile-closing__events-link {
          display: flex;
          margin-top: 1.25rem;
          background: rgba(229, 224, 213, 0.04);
        }

        .ruined-mobile-closing__nav {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 0.9rem 1.25rem;
          margin-top: 1.25rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.54rem;
          line-height: 1.4;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .ruined-mobile-closing__nav a {
          min-height: 2.75rem;
          display: inline-flex;
          align-items: center;
          color: color-mix(in srgb, var(--color-bone, #e5e0d5) 74%, transparent);
          text-decoration: none;
        }

        .ruined-mobile-closing__nav a:last-child {
          color: var(--color-signal, #e5a923);
        }

        @supports (height: 100svh) {
          .ruined-mobile-scene,
          .ruined-mobile-closing {
            height: 100svh;
            min-height: 100svh;
          }
        }

        @supports (height: 100dvh) {
          .ruined-mobile-scene,
          .ruined-mobile-closing {
            height: 100dvh;
            min-height: 100dvh;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .ruined-mobile-scene,
          .ruined-mobile-closing {
            scroll-snap-stop: normal;
          }

        }
      `}</style>
    </section>
  );
}
