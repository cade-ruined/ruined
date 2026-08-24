"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { Product } from "@/data/products";
import type { Project } from "@/data/projects";
import type { StudioEvent } from "@/data/events";
import { EXPLORE_ROOMS, type ExploreRoom } from "@/data/navigation";

const JOURNEY_GRID_CLASS =
  "grid grid-cols-3 gap-1 border border-white/25 bg-black/75 p-1 shadow-[7px_8px_0_rgba(0,0,0,0.5)] sm:gap-1.5 sm:p-1.5";
const JOURNEY_CARD_CLASS =
  "group relative aspect-[4/5] overflow-hidden bg-black/85 text-[var(--color-bone)] ring-1 ring-inset ring-white/15";
const JOURNEY_RAIL_CLASS =
  "flex touch-pan-x snap-x snap-mandatory gap-1 overflow-x-auto overscroll-x-contain border border-white/25 bg-black/75 p-1 shadow-[7px_8px_0_rgba(0,0,0,0.5)] [scrollbar-color:rgba(255,255,255,0.28)_transparent] [scrollbar-width:thin] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:gap-1.5 sm:p-1.5";
const JOURNEY_RAIL_CARD_CLASS =
  `${JOURNEY_CARD_CLASS} w-[58%] flex-none snap-start focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white sm:w-[38%] lg:w-[31.5%]`;
const HOME_MARQUEE_SPEED_PX_PER_SECOND = 20;
const HOME_MARQUEE_MAX_FRAME_MS = 48;
const HOME_MARQUEE_RESUME_DELAY_MS = 12000;
const BYOB_TANK_FEATURE_FALLBACK = {
  id: "byob-tank",
  title: "BYOB Tank",
  meta: "$32 · Preorder · Ships September",
  image: {
    url: "https://cdn.shopify.com/s/files/1/1001/4077/7793/files/BYOB_Tee_Product.png?v=1787271453",
    alt: "Black BYOB Tank shown front and back on dark earth among yellow wildflowers.",
  },
} as const;

function formatJourneyShipDate(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(date);
}

function requestWalkRoom(
  event: ReactMouseEvent<HTMLAnchorElement>,
  hash: string
) {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  const room = EXPLORE_ROOMS.find((candidate) => candidate.hash === hash);
  if (!room) return;

  const request = new CustomEvent("ruined:home-scene-request", {
    cancelable: true,
    detail: { hash: room.hash, index: room.sceneIndex },
  });
  if (!window.dispatchEvent(request)) event.preventDefault();
}

export function JourneySectionHero({
  room,
  headingId,
  showPosition = false,
  ctaHref,
  ctaLabel,
}: {
  room: ExploreRoom;
  headingId?: string;
  showPosition?: boolean;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div
      data-journey-section-hero={room.id}
      className="grid gap-2 border border-b-0 border-white/20 bg-black/82 px-4 py-3 text-[var(--color-bone)] backdrop-blur-sm sm:grid-cols-[minmax(0,1fr)_minmax(16rem,0.72fr)] sm:items-end sm:gap-6 sm:px-5 sm:py-4"
    >
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-4">
          <span
            className="inline-block origin-left text-[1.35rem] leading-none text-[var(--color-poster)] sm:text-[1.65rem]"
            style={{
              fontFamily: "var(--font-handwritten)",
              transform: "rotate(-3deg)",
            }}
          >
            {room.locator}
          </span>
          {showPosition && (
            <span className="shrink-0 font-[var(--font-header)] text-[0.58rem] font-bold tabular-nums text-white/40">
              {String(room.sceneIndex + 1).padStart(2, "0")} / {String(EXPLORE_ROOMS.length).padStart(2, "0")}
            </span>
          )}
        </div>
        <h2
          id={headingId}
          className="display mt-1 text-[clamp(1.55rem,3vw,2.8rem)] leading-[0.9] text-white"
        >
          {room.headline}
        </h2>
      </div>
      <div>
        <p className="max-w-lg text-[0.68rem] leading-relaxed text-white/60 sm:text-xs">
          {room.description}
        </p>
        {ctaHref && ctaLabel && (
          <Link
            href={ctaHref}
            className="ui-heading mt-2 inline-flex items-center gap-3 border-b border-white/35 pb-1 text-[0.62rem] text-white transition-colors hover:border-[var(--color-poster)] hover:text-[var(--color-poster)] sm:mt-3"
          >
            <span>{ctaLabel}</span>
            <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
    </div>
  );
}

type LobbySelection = {
  key: string;
  href?: string;
  external?: boolean;
  realm: "About" | "Social" | "Community" | "Store";
  title: string;
  meta: string;
  image?: string;
  video?: string;
  poster?: string;
  alt: string;
};

export function JourneyLobbyIndex({
  events,
  products,
}: {
  events: StudioEvent[];
  products: Product[];
}) {
  const byobOne = events.find((candidate) => candidate.id === "byob-01");
  const tank = products.find(
    (candidate) => candidate.id === BYOB_TANK_FEATURE_FALLBACK.id
  );
  const tankImage =
    tank?.images?.find((image) => image.url.includes("BYOB_Tee_Product.png")) ??
    tank?.image;
  const selections: LobbySelection[] = [
    // The marquee is newest-first. Add future features above the current lead.
    {
      key: "byob-tank",
      href: tank ? `/store/${tank.id}` : undefined,
      realm: "Store",
      title: tank?.name ?? BYOB_TANK_FEATURE_FALLBACK.title,
      meta: tank?.expectedShipDate
        ? `${tank.price.replace(/^([£$€])\s+/, "$1")} · Preorder · Ships ${formatJourneyShipDate(tank.expectedShipDate)}`
        : tank?.price ?? BYOB_TANK_FEATURE_FALLBACK.meta,
      image: tankImage?.url ?? BYOB_TANK_FEATURE_FALLBACK.image.url,
      alt: tankImage?.alt ?? BYOB_TANK_FEATURE_FALLBACK.image.alt,
    },
    ...(byobOne
      ? [
          {
            key: `events-${byobOne.id}`,
            href: `/community#${byobOne.id}`,
            realm: "Community" as const,
            title: byobOne.title,
            meta: `View the recap · ${byobOne.date}`,
            image: byobOne.image,
            alt: byobOne.gallery?.[0]?.alt ?? byobOne.title,
          },
        ]
      : []),
    {
      key: "meet-the-cast",
      href: "https://www.instagram.com/theruinedproject/",
      external: true,
      realm: "Social",
      title: "Meet the Cast",
      meta: "Watch on Instagram",
      video: "/media/meet-the-cast.mp4",
      poster: "/media/meet-the-cast-poster.jpg",
      alt: "Meet the Cast from The Ruined Project",
    },
    {
      key: "what-is-this",
      href: "#about",
      realm: "About",
      title: "What is this?",
      meta: "About Ruined",
      image: "/media/what-is-this.webp",
      alt: "The Ruined Project collage",
    },
  ];
  const marqueeRef = useRef<HTMLDivElement>(null);
  const marqueePauseReasonsRef = useRef(new Set<"drag" | "focus" | "hover">());
  const marqueeResumeAtRef = useRef(0);
  const marqueeDirectionRef = useRef<1 | -1>(1);
  const marqueeVisibleRef = useRef(false);
  const [marqueeStopped, setMarqueeStopped] = useState(false);

  useEffect(() => {
    const marquee = marqueeRef.current;
    if (!marquee || selections.length < 2) return;

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        marqueeVisibleRef.current = entry?.isIntersecting ?? false;
      },
      { threshold: 0.35 }
    );
    visibilityObserver.observe(marquee);
    let animationFrameId: number | undefined;
    let previousFrameTime: number | undefined;

    const drift = (frameTime: number) => {
      animationFrameId = window.requestAnimationFrame(drift);
      if (
        motionPreference.matches ||
        marqueeStopped ||
        marqueePauseReasonsRef.current.size > 0 ||
        !marqueeVisibleRef.current ||
        Date.now() < marqueeResumeAtRef.current ||
        document.visibilityState !== "visible"
      ) {
        marquee.style.removeProperty("scroll-snap-type");
        previousFrameTime = frameTime;
        return;
      }

      marquee.style.scrollSnapType = "none";
      const maxScroll = Math.max(0, marquee.scrollWidth - marquee.clientWidth);
      if (maxScroll <= 1) {
        previousFrameTime = frameTime;
        return;
      }

      const elapsedMs = Math.min(
        previousFrameTime === undefined ? 0 : frameTime - previousFrameTime,
        HOME_MARQUEE_MAX_FRAME_MS
      );
      previousFrameTime = frameTime;
      let nextScrollLeft =
        marquee.scrollLeft +
        marqueeDirectionRef.current *
          HOME_MARQUEE_SPEED_PX_PER_SECOND *
          (elapsedMs / 1000);

      if (nextScrollLeft >= maxScroll) {
        nextScrollLeft = maxScroll;
        marqueeDirectionRef.current = -1;
      } else if (nextScrollLeft <= 0) {
        nextScrollLeft = 0;
        marqueeDirectionRef.current = 1;
      }

      marquee.scrollLeft = nextScrollLeft;
    };

    const syncAutoplay = () => {
      if (animationFrameId !== undefined) {
        window.cancelAnimationFrame(animationFrameId);
      }
      marquee.style.removeProperty("scroll-snap-type");
      previousFrameTime = undefined;
      animationFrameId =
        motionPreference.matches || marqueeStopped
          ? undefined
          : window.requestAnimationFrame(drift);
    };

    syncAutoplay();
    motionPreference.addEventListener("change", syncAutoplay);
    return () => {
      if (animationFrameId !== undefined) {
        window.cancelAnimationFrame(animationFrameId);
      }
      marquee.style.removeProperty("scroll-snap-type");
      visibilityObserver.disconnect();
      motionPreference.removeEventListener("change", syncAutoplay);
    };
  }, [marqueeStopped, selections.length]);

  const deferMarquee = () => {
    marqueeResumeAtRef.current = Date.now() + HOME_MARQUEE_RESUME_DELAY_MS;
  };
  const pauseMarquee = (reason: "drag" | "focus" | "hover") => {
    marqueePauseReasonsRef.current.add(reason);
  };
  const resumeMarquee = (reason: "drag" | "focus" | "hover") => {
    marqueePauseReasonsRef.current.delete(reason);
    deferMarquee();
  };

  if (!selections.length) return null;

  return (
    <div data-journey-lobby-index className="relative">
      <div
        data-home-marquee
        ref={marqueeRef}
        className={JOURNEY_RAIL_CLASS}
        role="region"
        aria-label="Featured stories and products"
        tabIndex={0}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") pauseMarquee("hover");
        }}
        onPointerLeave={() => {
          resumeMarquee("hover");
          resumeMarquee("drag");
        }}
        onPointerDown={() => {
          pauseMarquee("drag");
          deferMarquee();
        }}
        onPointerUp={() => resumeMarquee("drag")}
        onPointerCancel={() => resumeMarquee("drag")}
        onWheel={deferMarquee}
        onFocusCapture={() => pauseMarquee("focus")}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            resumeMarquee("focus");
          }
        }}
      >
        {selections.map((selection, index) => {
          const content = <>
          {selection.video && (
            <video
              src={selection.video}
              poster={selection.poster}
              aria-label={selection.alt}
              muted
              loop
              autoPlay
              playsInline
              preload="metadata"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.025]"
            />
          )}
          {selection.image && (
            <Image
              src={selection.image}
              alt={selection.alt}
              fill
              sizes="(min-width: 1024px) 18rem, (min-width: 640px) 38vw, 58vw"
              priority={index === 0}
              fetchPriority={index === 0 ? "high" : "low"}
              className="object-cover transition-transform duration-700 group-hover:scale-[1.025]"
            />
          )}
          <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/5 to-black/35" />
          <span className="absolute left-2 top-2 bg-black/90 px-1.5 py-1 font-sans text-[clamp(0.4rem,0.9vw,0.5rem)] font-medium uppercase tracking-[0.16em] text-[var(--color-signal)] sm:left-3 sm:top-3 sm:tracking-[0.2em]">
            {selection.realm}
          </span>
          <span className="absolute bottom-2 left-2 right-2 sm:bottom-3 sm:left-3 sm:right-3">
            <strong className="journey-card-title block text-[clamp(0.78rem,2.2vw,1.25rem)] leading-[0.95] text-white">
              {selection.title}
            </strong>
            <span className="mt-1 flex items-end justify-between gap-1 font-sans text-[clamp(0.38rem,0.9vw,0.48rem)] uppercase leading-tight tracking-[0.08em] text-white/60 sm:tracking-[0.12em]">
              <span>{selection.meta}</span>
              {selection.href && <span className="shrink-0 text-white/80 transition-transform group-hover:translate-x-1">↗</span>}
            </span>
          </span>
          </>;
          return selection.href?.startsWith("#") ? (
            <a
              key={selection.key}
              href={selection.href}
              onClick={(event) => requestWalkRoom(event, selection.href!)}
              className={JOURNEY_RAIL_CARD_CLASS}
              data-home-marquee-item
            >
              {content}
            </a>
          ) : selection.href ? (
            <Link
              key={selection.key}
              href={selection.href}
              target={selection.external ? "_blank" : undefined}
              rel={selection.external ? "noreferrer" : undefined}
              className={JOURNEY_RAIL_CARD_CLASS}
              data-home-marquee-item
            >
              {content}
            </Link>
          ) : (
            <div
              key={selection.key}
              className={JOURNEY_RAIL_CARD_CLASS}
              data-home-marquee-item
            >
              {content}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setMarqueeStopped((current) => !current)}
        aria-pressed={marqueeStopped}
        aria-label={marqueeStopped ? "Play marquee" : "Pause marquee"}
        className="absolute right-3 top-3 z-20 flex min-h-11 min-w-11 items-center justify-center border border-white/35 bg-black/75 font-sans text-[0.65rem] text-white transition-colors hover:border-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <span aria-hidden="true">{marqueeStopped ? "▶" : "Ⅱ"}</span>
      </button>
    </div>
  );
}

export function JourneyStoreIndex({ products }: { products: Product[] }) {
  const featuredProducts = products.slice(0, 3);
  const productCount = featuredProducts.length;
  const shelfWidthClass =
    productCount <= 1
      ? "mx-auto max-w-[18rem]"
      : productCount === 2
        ? "mx-auto max-w-[38rem]"
        : "w-full";

  return (
    <div data-journey-store-index className="w-full">
      {productCount > 0 && (
        <div
          className={`${JOURNEY_GRID_CLASS} ${shelfWidthClass}`}
          style={{
            gridTemplateColumns: `repeat(${productCount}, minmax(0, 1fr))`,
          }}
        >
          {featuredProducts.map((product, index) => {
            const shipDate = product.expectedShipDate
              ? formatJourneyShipDate(product.expectedShipDate)
              : undefined;

            return (
              <Link
                key={product.id}
                href={`/store/${product.id}`}
                className={JOURNEY_CARD_CLASS}
              >
                {product.image && (
                  <Image
                    src={product.image.url}
                    alt={product.image.alt}
                    fill
                    sizes="(min-width: 640px) 22rem, 28vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-[1.025]"
                  />
                )}
                <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/20" />
                <span className="absolute left-2 top-2 font-sans text-[clamp(0.4rem,0.9vw,0.52rem)] font-medium uppercase tracking-[0.14em] text-white/70 sm:left-4 sm:top-4 sm:tracking-[0.2em]">
                  {index === 0 ? "Featured · " : ""}
                  {product.code}
                </span>
                <span className="absolute bottom-2 left-2 right-2 sm:bottom-4 sm:left-4 sm:right-4">
                  <strong className="journey-card-title block text-[clamp(0.62rem,1.8vw,1.125rem)] leading-tight text-white">
                    {product.name}
                  </strong>
                  <span className="mt-1 block font-sans text-[clamp(0.4rem,0.9vw,0.52rem)] uppercase tracking-[0.1em] text-white/65 sm:mt-2 sm:tracking-[0.16em]">
                    {product.price}
                  </span>
                  {shipDate && (
                    <span className="mt-1 block font-sans text-[clamp(0.38rem,0.82vw,0.5rem)] uppercase tracking-[0.08em] text-[var(--color-poster)] sm:tracking-[0.13em]">
                      Preorder · Est. ship {shipDate}
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}
      <div className={`mt-2 flex justify-end ${shelfWidthClass}`}>
        <Link
          href="/store"
          className="ui-heading inline-flex items-center gap-3 border-b border-white/35 pb-1 text-[0.58rem] text-white transition-colors hover:border-[var(--color-poster)] hover:text-[var(--color-poster)] sm:text-[0.62rem]"
        >
          <span>View catalogue</span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}

export function JourneyWorkIndex({ projects }: { projects: Project[] }) {
  const featuredProjects = projects.slice(0, 3);
  if (!featuredProjects.length) return null;

  return (
    <div className={JOURNEY_GRID_CLASS}>
      {featuredProjects.map((project, index) => (
        <div
          key={project.no}
          className={JOURNEY_CARD_CLASS}
        >
          {project.image && (
            <Image
              src={project.image}
              alt={project.title}
              fill
              sizes="(min-width: 640px) 22rem, 28vw"
              className="object-cover transition-transform duration-700 group-hover:scale-[1.025]"
            />
          )}
          <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
          <span className="absolute left-2 top-2 font-sans text-[clamp(0.4rem,0.9vw,0.52rem)] font-medium uppercase tracking-[0.14em] text-white/70 sm:left-4 sm:top-4 sm:tracking-[0.2em]">
            {index === 0 ? "Featured · " : ""}
            RU / {project.no}
          </span>
          <span className="absolute bottom-2 left-2 right-2 sm:bottom-4 sm:left-4 sm:right-4">
            <strong className="journey-card-title block text-[clamp(0.62rem,1.8vw,1.125rem)] leading-tight text-white">
              {project.title}
            </strong>
            <span className="mt-1 flex items-center justify-between font-sans text-[clamp(0.4rem,0.9vw,0.52rem)] uppercase tracking-[0.1em] text-white/65 sm:mt-2 sm:tracking-[0.16em]">
              <span>
                {project.medium} · {project.year}
              </span>
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function JourneyAboutIndex() {
  const selections = [
    {
      image: "/ruined-hero-lounge.jpg",
      alt: "The lounge at Studio No. 17",
      label: "Studio No. 17",
      title: "What remains, remains.",
      meta: "Practice / Utah / MMXXVI",
    },
    {
      image: "/art/shelf.jpg",
      alt: "Objects and garments from the Ruined studio",
      label: "Objects",
      title: "Objects / Garments",
      meta: "Material / Use / Wear",
    },
    {
      image: "/art/loft.jpg",
      alt: "The Ruined studio loft",
      label: "Spaces",
      title: "Spaces / Direction",
      meta: "Studio / Utah / MMXXVI",
    },
  ];

  return (
    <div className={JOURNEY_GRID_CLASS}>
      {selections.map((selection) => (
        <div key={selection.title} className={JOURNEY_CARD_CLASS}>
          <Image
            src={selection.image}
            alt={selection.alt}
            fill
            sizes="(min-width: 640px) 22rem, 28vw"
            className="object-cover transition-transform duration-700 group-hover:scale-[1.025]"
          />
          <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
          <span className="absolute left-2 top-2 font-sans text-[clamp(0.4rem,0.9vw,0.52rem)] font-medium uppercase tracking-[0.14em] text-white/70 sm:left-4 sm:top-4 sm:tracking-[0.2em]">
            {selection.label}
          </span>
          <span className="absolute bottom-2 left-2 right-2 sm:bottom-4 sm:left-4 sm:right-4">
            <strong className="journey-card-title block text-[clamp(0.62rem,1.8vw,1.125rem)] leading-tight text-white">
              {selection.title}
            </strong>
            <span className="mt-1 flex items-center justify-between font-sans text-[clamp(0.4rem,0.9vw,0.52rem)] uppercase tracking-[0.1em] text-white/65 sm:mt-2 sm:tracking-[0.16em]">
              <span>{selection.meta}</span>
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function JourneyEventsIndex({ events }: { events: StudioEvent[] }) {
  const nextAvailable = events.find((event) => event.status === "Upcoming");
  const visibleEvents = events.slice(0, 3);
  const compactGridClass =
    visibleEvents.length === 1
      ? "sm:mx-auto sm:w-1/3"
      : visibleEvents.length === 2
        ? "sm:mx-auto sm:w-2/3"
        : "";

  return (
    <div>
      <div
        className={`${JOURNEY_GRID_CLASS} ${compactGridClass}`}
        style={{
          gridTemplateColumns: `repeat(${Math.max(visibleEvents.length, 1)}, minmax(0, 1fr))`,
        }}
      >
        {visibleEvents.map((event, index) => {
          const isEnded = event.status === "Ended";
          const isNextAvailable = event.id === nextAvailable?.id;
          const isDimmed = !isNextAvailable;

          return (
            <Link
              key={event.id}
              href={`/community#${event.id}`}
              className={JOURNEY_CARD_CLASS}
              data-event-dimmed={isDimmed ? "true" : undefined}
            >
              {event.image && (
                <Image
                  src={event.image}
                  alt={event.gallery?.[0]?.alt ?? event.title}
                  fill
                  sizes="(min-width: 640px) 22rem, 28vw"
                  className="object-cover transition-transform duration-700 group-hover:scale-[1.025]"
                />
              )}
              <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
              {isDimmed && (
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-0 transition-colors duration-300 group-hover:bg-black/40 group-focus-visible:bg-black/40 ${isEnded ? "bg-black/45" : "bg-black/55"}`}
                />
              )}
              <span className="absolute left-2 top-2 font-sans text-[clamp(0.4rem,0.9vw,0.52rem)] font-medium uppercase tracking-[0.14em] text-white/70 sm:left-4 sm:top-4 sm:tracking-[0.2em]">
                {isEnded
                  ? `Ended · 0${index + 1}`
                  : isNextAvailable
                    ? `Available · 0${index + 1}`
                    : `0${index + 1}`}
              </span>
              <span className="absolute bottom-2 left-2 right-2 sm:bottom-4 sm:left-4 sm:right-4">
                <strong className="journey-card-title block text-[clamp(0.62rem,1.8vw,1.125rem)] leading-tight text-white">
                  {event.title}
                </strong>
                <span className="mt-1 flex items-center justify-between font-sans text-[clamp(0.4rem,0.9vw,0.52rem)] uppercase tracking-[0.1em] text-white/65 sm:mt-2 sm:tracking-[0.16em]">
                  <span>{event.date}</span>
                  <span className="transition-transform group-hover:translate-x-1">
                    ↗
                  </span>
                </span>
              </span>
            </Link>
          );
        })}
      </div>
      <Link
        href="/community"
        className="ui-heading mt-3 flex items-center justify-between border border-white/25 bg-black/80 px-4 py-3 text-xs text-white"
      >
        <span>See all events</span>
        <span aria-hidden="true">→</span>
      </Link>
    </div>
  );
}
