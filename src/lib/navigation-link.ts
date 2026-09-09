import { publicWebsiteHref } from "@/lib/site";

type NavigationClick = Pick<MouseEvent,
  "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented"
> & {
  currentTarget: Pick<HTMLAnchorElement, "href" | "target" | "hasAttribute">;
};

/** A dismissed overlay owns focus until this tab actually leaves its destination. */
export function shouldRestoreLinkFocus(event: NavigationClick, currentHref: string): boolean {
  const link = event.currentTarget;
  if (
    event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
    event.shiftKey || event.altKey || link.hasAttribute("download") ||
    (link.target && link.target.toLowerCase() !== "_self")
  ) return true;

  const current = new URL(currentHref);
  const destination = new URL(link.href, current);
  return destination.origin === current.origin &&
    destination.pathname === current.pathname &&
    destination.search === current.search &&
    (!destination.hash || destination.hash === current.hash);
}

/** Public search exits the member host; account and operator destinations do not. */
export function publicSearchHref(href: string): string {
  if (
    !href.startsWith("/") || href.startsWith("//") ||
    /^\/(?:my|ops|access|auth)(?:[/?#]|$)/.test(href)
  ) return href;
  return publicWebsiteHref(href);
}
