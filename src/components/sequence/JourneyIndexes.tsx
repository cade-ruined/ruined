"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { Product } from "@/data/products";
import type { Project } from "@/data/projects";
import type { StudioEvent } from "@/data/events";
import { EXPLORE_ROOMS, type ExploreRoom } from "@/data/navigation";
import { MEMBERSHIP_INTRO } from "@/data/public-membership";
import { catalogNotice, type CatalogStatus } from "@/lib/store/catalog";
import { getProductColorHref, getProductColorImages } from "@/lib/store/product-colors";
import JourneyQuickBuy from "./JourneyQuickBuy";

const JOURNEY_GRID_CLASS =
  "grid grid-cols-3 gap-1 border border-white/25 bg-black/75 p-1 shadow-[7px_8px_0_rgba(0,0,0,0.5)] sm:gap-1.5 sm:p-1.5";
const JOURNEY_CARD_CLASS =
  "group relative aspect-[4/5] overflow-hidden bg-black/85 text-[var(--color-bone)] ring-1 ring-inset ring-white/15";
const JOURNEY_RAIL_CLASS =
  "flex touch-pan-x snap-x snap-mandatory scroll-px-1 gap-1 overflow-x-auto overscroll-x-contain border border-white/25 bg-black/75 p-1 shadow-[7px_8px_0_rgba(0,0,0,0.5)] [scrollbar-color:rgba(255,255,255,0.28)_transparent] [scrollbar-width:thin] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:scroll-px-1.5 sm:gap-1.5 sm:p-1.5";
const JOURNEY_RAIL_CARD_CLASS =
  `${JOURNEY_CARD_CLASS} w-[58%] flex-none snap-start focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white sm:w-[38%] lg:w-[31.5%]`;

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
  realm: "About" | "Members" | "Social" | "Community" | "Store";
  title: string;
  meta: string;
  image?: string;
  video?: string;
  poster?: string;
  products?: Product[];
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
  const nextByob = events.find((candidate) => candidate.id.startsWith("byob-") && candidate.registration?.status === "Open" && candidate.status !== "Ended");
  const newProducts = products
    .filter((product) => product.id !== "byob-tank" && product.image)
    .slice(0, 9);
  const selections: LobbySelection[] = [
    ...(nextByob?.registration
      ? [{
          key: `events-${nextByob.id}`,
          href: nextByob.registration.href,
          realm: "Community" as const,
          title: nextByob.title,
          meta: `Register now · ${nextByob.date}`,
          image: nextByob.image ?? byobOne?.image,
          alt: `${nextByob.title} community gathering in the mountains.`,
        }]
      : []),
    ...(newProducts.length
      ? [{
          key: "new-arrivals",
          href: "/store",
          realm: "Store" as const,
          title: "New arrivals",
          meta: "Shop the collection",
          products: newProducts,
          alt: "New Ruined apparel",
        }]
      : []),
    {
      key: "members-introduction",
      href: "#members",
      realm: "Members",
      title: "Join waitlist",
      meta: "Good company. Real work.",
      image: MEMBERSHIP_INTRO.image,
      alt: MEMBERSHIP_INTRO.alt,
    },
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
  ];
  const leadingSelectionKey = selections[0]?.key;
  const marqueeRef = useRef<HTMLDivElement>(null);
  const [canScrollBack, setCanScrollBack] = useState(false);
  const [canScrollForward, setCanScrollForward] = useState(false);

  const updateScrollControls = () => {
    const rail = marqueeRef.current;
    if (!rail) return;
    setCanScrollBack(rail.scrollLeft > 2);
    setCanScrollForward(rail.scrollLeft < rail.scrollWidth - rail.clientWidth - 2);
  };

  useEffect(() => {
    const rail = marqueeRef.current;
    if (!rail) return;
    updateScrollControls();
    const observer = new ResizeObserver(updateScrollControls);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [leadingSelectionKey, selections.length]);

  const scrollFeature = (direction: -1 | 1) => {
    const rail = marqueeRef.current;
    if (!rail) return;
    const first = rail.children[0] as HTMLElement | undefined;
    const second = rail.children[1] as HTMLElement | undefined;
    const step = first && second
      ? second.offsetLeft - first.offsetLeft
      : rail.clientWidth;
    rail.scrollBy({
      left: direction * step,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  };

  if (!selections.length) return null;

  return (
    <div data-journey-lobby-index className="relative">
      <div
        key={leadingSelectionKey}
        data-home-marquee
        ref={marqueeRef}
        className={JOURNEY_RAIL_CLASS}
        role="region"
        aria-label="Featured stories and products"
        tabIndex={0}
        onScroll={updateScrollControls}
      >
        {selections.map((selection, index) => {
          const content = <>
          {selection.products && (
            <span
              data-home-product-grid
              className={`absolute inset-x-0 top-0 bottom-[3.6rem] grid gap-px bg-black/90 ${selection.products.length > 4 ? "grid-cols-3 grid-rows-3" : selection.products.length > 1 ? "grid-cols-2 grid-rows-2" : "grid-cols-1"}`}
            >
              {selection.products.map((product) => (
                <span key={product.id} className="relative min-h-0 min-w-0 overflow-hidden">
                  <Image
                    src={product.image!.url}
                    alt={product.name}
                    fill
                    sizes="(min-width: 1024px) 7rem, (min-width: 640px) 13vw, 20vw"
                    className="object-cover transition-transform duration-700 group-hover:scale-[1.025]"
                  />
                </span>
              ))}
            </span>
          )}
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
          <span className={`absolute inset-0 ${selection.products ? "bg-gradient-to-b from-black/25 via-transparent to-transparent" : "bg-gradient-to-t from-black/85 via-black/5 to-black/35"}`} />
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
      <div className="mt-2 flex justify-end gap-1" aria-label="Carousel controls">
        <button
          type="button"
          onClick={() => scrollFeature(-1)}
          disabled={!canScrollBack}
          aria-label="Previous feature"
          className="flex min-h-11 min-w-11 items-center justify-center border border-white/35 bg-black/75 text-white transition-colors hover:border-white disabled:cursor-default disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <span aria-hidden="true">←</span>
        </button>
        <button
          type="button"
          onClick={() => scrollFeature(1)}
          disabled={!canScrollForward}
          aria-label="Next feature"
          className="flex min-h-11 min-w-11 items-center justify-center border border-white/35 bg-black/75 text-white transition-colors hover:border-white disabled:cursor-default disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}

export function JourneyStoreIndex({
  products,
  catalogStatus = products.length ? "ready" : "unavailable",
}: {
  products: Product[];
  catalogStatus?: CatalogStatus;
}) {
  const rackSelections = [
    { id: "sunday-clothes-hoodie", color: "Grey" },
    { id: "womens-crop-tee" },
    { id: "mens-less-permanent-tee" },
  ];
  const featuredProducts: { product: Product; color?: string }[] = [];
  for (const { id, color } of rackSelections) {
    const product = products.find((item) => item.id === id);
    if (product) featuredProducts.push({ product, color });
  }
  // Keep the shelf useful if a featured product leaves the published catalog.
  for (const product of products) {
    if (featuredProducts.length === 3) break;
    if (!featuredProducts.some((entry) => entry.product.id === product.id)) featuredProducts.push({ product });
  }
  const productCount = featuredProducts.length;
  const notice = catalogNotice(catalogStatus);
  const shelfWidthClass =
    productCount <= 1
      ? "mx-auto max-w-[18rem]"
      : productCount === 2
        ? "mx-auto max-w-[38rem]"
        : "w-full";
  const rackHeadingSizeClass = productCount <= 1
    ? "text-[1.375rem] sm:text-[1.5rem]"
    : "text-[1.75rem] sm:text-[2.25rem]";

  return (
    <div data-journey-store-index className="w-full">
      <div className={`mb-2 flex items-center justify-between gap-3 text-[var(--color-bone)] ${shelfWidthClass}`}>
        <h2 className={`shrink-0 whitespace-nowrap ![font-family:var(--font-cadehandy2)] !font-normal leading-none !tracking-normal text-[var(--color-poster)] ${rackHeadingSizeClass}`}>
          On the Rack
        </h2>
        <Link
          href="/store"
          aria-label={productCount === 0 && notice.retry ? "Off the Rack — try the catalog again" : "Off the Rack — view the full catalog"}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 bg-black px-2 py-2 font-sans text-xs text-white transition-colors hover:text-[var(--color-poster)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:px-4 sm:text-sm"
        >
          <span>Off the Rack</span>
          <span aria-hidden="true">↗</span>
        </Link>
      </div>
      {productCount === 0 && (
        <div data-catalog-status={catalogStatus} className="mx-auto max-w-sm rounded-sm bg-black/80 px-5 py-4 text-[var(--color-bone)]">
          <p className="ui-heading text-base">{notice.heading}</p>
          <p className="mt-2 text-xs leading-relaxed text-white/65">{notice.detail}</p>
          <Link href="/contact" className="mt-2 inline-flex min-h-11 items-center text-xs underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
            Contact Ruined
          </Link>
        </div>
      )}
      {productCount > 0 && (
        <div
          data-journey-rack
          role="region"
          aria-label="On the Rack products"
          tabIndex={productCount > 1 ? 0 : undefined}
          onPointerDown={(event) => {
            if (event.currentTarget.scrollWidth > event.currentTarget.clientWidth) event.stopPropagation();
          }}
          className={`${JOURNEY_GRID_CLASS} ${shelfWidthClass} max-sm:flex max-sm:gap-2 max-sm:overflow-x-auto max-sm:overscroll-x-contain max-sm:snap-x max-sm:snap-mandatory max-sm:scroll-px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white`}
          style={{
            gridTemplateColumns: `repeat(${productCount}, minmax(0, 1fr))`,
          }}
        >
          {featuredProducts.map(({ product, color }, index) => {
            const [firstImage, secondImage] = getProductColorImages(product, color);
            const shipDate = product.expectedShipDate
              ? formatJourneyShipDate(product.expectedShipDate)
              : undefined;

            return (
              <article
                key={product.id}
                data-journey-product-card={product.id}
                aria-label={product.name}
                className={`flex min-w-0 flex-col bg-black/85 text-[var(--color-bone)] max-sm:shrink-0 max-sm:snap-start ${productCount > 1 ? "max-sm:w-[84%] max-sm:max-w-[max(12rem,calc((100svh_-_20rem)*0.8))]" : "max-sm:w-full"}`}
              >
                <Link
                  href={getProductColorHref(product, color)}
                  className={`${JOURNEY_CARD_CLASS} block max-sm:max-h-[max(4.5rem,calc(100svh_-_20rem))] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white`}
                >
                  {firstImage && (
                    <Image
                      src={firstImage.url}
                      alt={firstImage.alt}
                      fill
                      sizes="(min-width: 640px) 22rem, 84vw"
                      className="object-cover transition-transform duration-700 group-hover:scale-[1.025]"
                    />
                  )}
                  {firstImage && secondImage && secondImage.url !== firstImage.url && (
                    <Image
                      src={secondImage.url}
                      alt=""
                      aria-hidden="true"
                      fill
                      sizes="(min-width: 640px) 22rem, 84vw"
                      className="pointer-events-none object-cover opacity-0 transition-opacity duration-300 motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100"
                    />
                  )}
                  <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/20" />
                  <span className="absolute left-3 top-3 font-sans text-[0.6rem] font-medium uppercase tracking-[0.14em] text-white/70 max-sm:[@media(max-height:480px)]:hidden sm:left-4 sm:top-4 sm:text-[clamp(0.4rem,0.9vw,0.52rem)] sm:tracking-[0.2em]">
                    {index === 0 ? "Featured · " : ""}
                    {product.code}
                  </span>
                  <span className="absolute bottom-3 left-3 right-3 sm:bottom-4 sm:left-4 sm:right-4">
                    <strong className="journey-card-title block text-base leading-tight text-white sm:text-[clamp(0.62rem,1.8vw,1.125rem)]">
                      {product.name}
                    </strong>
                    <span className="mt-1 block font-sans text-[0.6rem] uppercase tracking-[0.1em] text-white/65 sm:mt-2 sm:text-[clamp(0.4rem,0.9vw,0.52rem)] sm:tracking-[0.16em]">
                      {color ? `${color} · ` : ""}{product.price}
                    </span>
                    {shipDate && (
                      <span className="mt-1 block font-sans text-[clamp(0.38rem,0.82vw,0.5rem)] uppercase tracking-[0.08em] text-[var(--color-poster)] sm:tracking-[0.13em]">
                        Preorder · Est. ship {shipDate}
                      </span>
                    )}
                  </span>
                </Link>
                <JourneyQuickBuy product={product} color={color} />
              </article>
            );
          })}
        </div>
      )}
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
