type LockOptions = {
  restoreScroll?: () => boolean;
};

const STYLE_PROPERTIES = ["overflow", "padding-right", "position", "top", "left", "width"] as const;

type ScrollLock = {
  users: number;
  body: HTMLElement;
  previous: { property: typeof STYLE_PROPERTIES[number]; value: string; priority: string }[];
  fixedBody: boolean;
  scrollX: number;
  scrollY: number;
  restoreScroll?: () => boolean;
};

let activeLock: ScrollLock | null = null;

/** Product dialogs share one baseline so nested cleanup order cannot strand the page. */
export function acquireProductScrollLock({ restoreScroll }: LockOptions = {}): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};

  if (!activeLock) {
    const body = document.body;
    const previous = STYLE_PROPERTIES.map((property) => ({
      property,
      value: body.style.getPropertyValue(property),
      priority: body.style.getPropertyPriority(property),
    }));
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const fixedBody = window.matchMedia("(pointer: coarse)").matches;
    const scrollbar = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    if (scrollbar) {
      const padding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
      body.style.setProperty("padding-right", `${padding + scrollbar}px`);
    }
    body.style.setProperty("overflow", "hidden");
    if (fixedBody) {
      body.style.setProperty("position", "fixed");
      body.style.setProperty("top", `${-scrollY}px`);
      body.style.setProperty("left", `${-scrollX}px`);
      body.style.setProperty("width", "100%");
    }
    activeLock = { users: 0, body, previous, fixedBody, scrollX, scrollY, restoreScroll };
  }

  const lock = activeLock;
  lock.users += 1;
  let released = false;

  return () => {
    if (released) return;
    released = true;
    lock.users -= 1;
    if (lock.users > 0) return;

    activeLock = null;
    for (const { property, value, priority } of lock.previous) {
      if (value) lock.body.style.setProperty(property, value, priority);
      else lock.body.style.removeProperty(property);
    }
    if (lock.fixedBody && (lock.restoreScroll?.() ?? true)) {
      window.scrollTo({ left: lock.scrollX, top: lock.scrollY, behavior: "instant" });
    }
  };
}
