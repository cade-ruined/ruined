/**
 * One responsive contract for the immersive homepage.
 *
 * The desktop sequence is reserved for a genuinely desktop-sized, precise
 * pointer. Phones, tablets, touch-first displays, and compact hybrid devices
 * use the lighter gesture stage. Keeping these queries together prevents a
 * viewport from falling through to the static server-rendered scene stack.
 */
export const DESKTOP_EXPERIENCE_QUERY =
  "(min-width: 1025px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)";

export const MOBILE_STAGE_QUERY = [
  "(max-width: 1024px)",
  "(hover: none)",
  "(pointer: coarse)",
  "((max-width: 1366px) and (any-pointer: coarse))",
].join(", ");

export function immersiveExperienceMediaQueries() {
  return [
    window.matchMedia(DESKTOP_EXPERIENCE_QUERY),
    window.matchMedia(MOBILE_STAGE_QUERY),
  ] as const;
}

export function isDesktopImmersiveExperience() {
  if (typeof window === "undefined") return false;
  const [desktop, stage] = immersiveExperienceMediaQueries();
  return desktop.matches && !stage.matches;
}

export function isMobileStageExperience() {
  if (typeof window === "undefined") return true;
  return window.matchMedia(MOBILE_STAGE_QUERY).matches;
}
