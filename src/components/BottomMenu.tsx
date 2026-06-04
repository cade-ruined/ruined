"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import BottomMenuArt from "@/imports/Group5-1/Group5";

const BOTTOM_MENU_W = 518.5;
const BOTTOM_MENU_H = 185.548;
const FRAME_LEFT = 48.64;
const FRAME_W = 414.716;
const FRAME_H = 76.552;
const ICON_W = FRAME_W / 4;

type MenuItem = { id: string; label: string; href: string };

// `id: "top"` is the hero; the others target the in-page sections on
// the home page. hrefs are absolute (`/#section`) so clicking from
// /store (or any non-home route) loads home and then jumps to the
// section. On the home page itself, the onClick handler intercepts and
// smooth-scrolls instead, so no navigation/flicker.
const ITEMS: MenuItem[] = [
  { id: "top", label: "Home", href: "/" },
  { id: "store", label: "Store", href: "/#store" },
  { id: "work", label: "Work", href: "/#work" },
  { id: "about", label: "About", href: "/#about" },
];

function useViewportWidth() {
  const [vw, setVw] = useState<number>(BOTTOM_MENU_W);
  useEffect(() => {
    const update = () => setVw(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return vw;
}

/**
 * Watches the page for which of the section elements is currently in view
 * and returns its id. Falls back to "top" while the user is in the hero
 * (no section past the activation line) or scrolled back near the page top.
 */
function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState<string>("top");

  useEffect(() => {
    const targets = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (targets.length === 0) return;

    const visible = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.set(entry.target.id, entry.intersectionRatio);
          } else {
            visible.delete(entry.target.id);
          }
        }

        if (visible.size === 0) {
          // Nothing in the activation band → user is in the hero or in a gap.
          // Prefer "top" when scrolled near the page start, else last seen.
          setActive((prev) =>
            window.scrollY < window.innerHeight * 0.5 ? "top" : prev
          );
          return;
        }

        // Pick the most-visible non-top section.
        let bestId = "top";
        let bestRatio = -1;
        for (const [id, ratio] of visible) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }
        setActive(bestId);
      },
      {
        // Activation band: middle 40% of the viewport.
        rootMargin: "-30% 0px -30% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );

    targets.forEach((t) => observer.observe(t));

    // Also reset to "top" whenever the user scrolls back into the hero.
    const onScroll = () => {
      if (window.scrollY < window.innerHeight * 0.5) setActive("top");
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [ids]);

  return active;
}

// Icon fills: the active nav item paints poster-red, the rest stay
// bone-white. (Switched from opacity-dimming to a red active state.)
const ACTIVE_ICON_FILL = "var(--color-primary)";
const INACTIVE_ICON_FILL = "#ffffff";

export default function BottomMenu() {
  const vw = useViewportWidth();
  const pathname = usePathname();
  const router = useRouter();
  // Active-section tracking only runs on the home page (the only place
  // those section ids exist). On /store and other deep routes, the
  // route itself drives the active icon below.
  const isHome = pathname === "/";
  const activeFromSections = useActiveSection(["store", "work", "about"]);
  const activeId = isHome
    ? activeFromSections
    : pathname.startsWith("/store")
      ? "store"
      : pathname.startsWith("/work")
        ? "work"
        : pathname.startsWith("/about")
          ? "about"
          : "top";

  const targetW = Math.min(vw, BOTTOM_MENU_W);
  const menuScale = targetW / BOTTOM_MENU_W;
  const height = BOTTOM_MENU_H * menuScale;
  const activeIndex = ITEMS.findIndex((item) => item.id === activeId);

  // Treat the couch as a normal menu bar — publish its actual rendered
  // height as a CSS custom property so other overlay UI (Position 2 CTA,
  // ScrollHint, future toasts, etc.) can offset cleanly above it instead
  // of guessing with hardcoded `vh` values that overlap the couch on
  // wider viewports. Updates on every resize so it stays in sync.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--bottom-menu-h", `${height}px`);
    return () => {
      root.style.removeProperty("--bottom-menu-h");
    };
  }, [height]);

  return (
    <motion.nav
      aria-label="Primary"
      initial={{ y: 48, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.35, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      className="fixed left-1/2 bottom-0 -translate-x-1/2 pointer-events-none z-50"
      style={{ width: targetW, height }}
    >
      <div
        className="bottom-menu-art absolute top-0 left-0 origin-top-left"
        style={
          {
            width: BOTTOM_MENU_W,
            height: BOTTOM_MENU_H,
            transform: `scale(${menuScale})`,
            // CSS variables consumed by .bottom-menu-art [id="Vector*"]
            // path rules in styles/index.css — the SVG icon paths
            // themselves pick up these fills, so the *active icon* turns
            // red while the rest stay white (no square overlay).
            "--icon-0-fill": activeIndex === 0 ? ACTIVE_ICON_FILL : INACTIVE_ICON_FILL,
            "--icon-1-fill": activeIndex === 1 ? ACTIVE_ICON_FILL : INACTIVE_ICON_FILL,
            "--icon-2-fill": activeIndex === 2 ? ACTIVE_ICON_FILL : INACTIVE_ICON_FILL,
            "--icon-3-fill": activeIndex === 3 ? ACTIVE_ICON_FILL : INACTIVE_ICON_FILL,
          } as React.CSSProperties
        }
      >
        <BottomMenuArt />

        <div
          className="absolute"
          style={{ left: FRAME_LEFT, top: 0, width: FRAME_W, height: FRAME_H }}
        >
          {ITEMS.map((item, i) => {
            const active = item.id === activeId;
            return (
              <a
                key={item.id}
                href={item.href}
                aria-label={item.label}
                aria-current={active ? "location" : undefined}
                onClick={(e) => {
                  // Home tap: smooth-scroll if already on home; else
                  // let the router push to "/".
                  if (item.id === "top") {
                    if (isHome) {
                      e.preventDefault();
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    } else {
                      e.preventDefault();
                      router.push("/");
                    }
                    return;
                  }

                  // Section taps: if we're on home, intercept and
                  // smooth-scroll to the in-page anchor (same animation
                  // on every browser, even with reduced-motion). If
                  // we're on a deep route (e.g. /store), let the
                  // browser navigate to /#section — the hash will
                  // resolve once home mounts.
                  const el = isHome
                    ? document.getElementById(item.id)
                    : null;
                  if (el) {
                    e.preventDefault();
                    el.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
                }}
                className="absolute pointer-events-auto focus:outline-none"
                style={{
                  left: i * ICON_W,
                  top: 0,
                  width: ICON_W,
                  height: FRAME_H,
                }}
              >
                {/* The icon itself dims via SVG path opacity driven by
                    the --icon-{0..3}-opacity vars on the parent — no
                    overlay needed. The active red dot lives below. */}
                {active && (
                  <motion.span
                    aria-hidden
                    layoutId="bottom-menu-active-dot"
                    className="absolute left-1/2 -translate-x-1/2"
                    style={{
                      bottom: -8,
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: "var(--color-primary)",
                      // Poster-red halo matches the new primary
                      boxShadow:
                        "0 0 10px rgba(208,49,45,0.85), 0 0 18px rgba(208,49,45,0.4)",
                    }}
                    transition={{ type: "spring", stiffness: 380, damping: 28 }}
                  />
                )}
              </a>
            );
          })}
        </div>
      </div>
    </motion.nav>
  );
}
