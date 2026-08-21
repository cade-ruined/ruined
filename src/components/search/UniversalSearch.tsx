"use client";

import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  SEARCH_GROUPS,
  type SearchGroup,
  type SearchResponse,
} from "@/data/search-contract";
import styles from "./UniversalSearch.module.css";

const GROUP_LABELS: Record<SearchGroup, string> = {
  pieces: "Pieces",
  projects: "Projects",
  events: "Community",
  pages: "Pages",
};

type UniversalSearchProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function UniversalSearch({
  open,
  onOpenChange,
}: UniversalSearchProps) {
  const titleId = useId();
  const statusId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const restoreFocusOnCloseRef = useRef(true);
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    restoreFocusOnCloseRef.current = true;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });

    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      const shouldRestoreFocus = restoreFocusOnCloseRef.current;
      restoreFocusOnCloseRef.current = true;
      if (shouldRestoreFocus) {
        requestAnimationFrame(() => {
          restoreFocusRef.current?.focus({ preventScroll: true });
        });
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        const result = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!result.ok) throw new Error("Search request failed");
        setResponse((await result.json()) as SearchResponse);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query ? 140 : 0);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query]);

  if (!open) return null;

  const close = () => onOpenChange(false);
  const closeForNavigation = () => {
    restoreFocusOnCloseRef.current = false;
    onOpenChange(false);
  };
  const hasResults = Boolean(response?.total);
  const statusMessage = failed
    ? "Search is temporarily unavailable."
    : loading && !response
      ? "Loading search."
      : response?.query
        ? `${response.total} result${response.total === 1 ? "" : "s"} for ${response.query}.`
        : "Showing suggested destinations.";

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;

    const focusable = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => !element.hasAttribute("hidden"));
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleBackdropClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) close();
  };

  const focusFirstResult = () => {
    panelRef.current?.querySelector<HTMLAnchorElement>("[data-search-result]")?.focus();
  };

  return (
    <div className={styles.backdrop} onMouseDown={handleBackdropClick}>
      <div
        ref={panelRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={statusId}
        onKeyDown={handlePanelKeyDown}
      >
        <div className={styles.headingRow}>
          <h2 id={titleId} className={styles.title}>Search Ruined</h2>
          <button type="button" className={styles.close} onClick={close} aria-label="Close search">
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <label className={styles.searchField}>
          <span className={styles.visuallyHidden}>Search pieces, projects, events, and pages</span>
          <svg className={styles.searchIcon} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.8" cy="10.8" r="6.8" />
            <path d="m16 16 4.5 4.5" />
          </svg>
          <input
            ref={inputRef}
            className={styles.input}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                focusFirstResult();
              }
            }}
            placeholder="Search everything"
            autoComplete="off"
            spellCheck="false"
          />
          {query && (
            <button
              type="button"
              className={styles.clear}
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
            >
              Clear
            </button>
          )}
        </label>

        <p id={statusId} className={styles.status} aria-live="polite" aria-atomic="true">
          {statusMessage}
        </p>

        <div className={styles.results} aria-busy={loading}>
          {failed ? (
            <div className={styles.empty}>
              <p>Search is temporarily unavailable.</p>
              <Link href="/store" onClick={closeForNavigation}>Browse the shop instead →</Link>
            </div>
          ) : !response && loading ? (
            <div className={styles.loading} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ) : response && hasResults ? (
            SEARCH_GROUPS.map((group) => {
              const items = response.groups[group];
              if (!items.length) return null;
              return (
                <section className={styles.group} key={group} aria-labelledby={`${titleId}-${group}`}>
                  <div className={styles.groupHeading}>
                    <h3 id={`${titleId}-${group}`}>{GROUP_LABELS[group]}</h3>
                    <span>{items.length}</span>
                  </div>
                  <div className={styles.groupItems}>
                    {items.map((item) => (
                      <Link
                        data-search-result
                        key={`${group}-${item.id}`}
                        href={item.href}
                        className={styles.result}
                        onClick={closeForNavigation}
                      >
                        <span className={styles.resultCopy}>
                          <span className={styles.resultTitle}>{item.title}</span>
                          <span className={styles.resultDescription}>{item.description}</span>
                        </span>
                        <span className={styles.resultMeta}>{item.meta}</span>
                        <span className={styles.arrow} aria-hidden="true">↗</span>
                      </Link>
                    ))}
                  </div>
                </section>
              );
            })
          ) : response ? (
            <div className={styles.empty}>
              <p>No pieces, projects, events, or pages match “{query.trim()}”.</p>
              <button type="button" onClick={() => setQuery("")}>Clear search</button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
