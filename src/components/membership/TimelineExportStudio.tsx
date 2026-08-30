"use client";

import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  DEFAULT_TIMELINE_ARTWORK_FORMAT,
  TIMELINE_ARTWORK_FORMATS,
  getTimelineArtworkFormat,
  paginateTimelineArtwork,
  timelineArtworkFilename,
  type TimelineArtworkFormatId,
} from "@/components/membership/timeline-artwork";
import {
  canvasToPngBlob,
  loadTimelinePaper,
  previewTimelineArtworkFormat,
  readTimelineArtworkFonts,
  renderTimelineArtwork,
} from "@/components/membership/timeline-canvas";
import type { TimelineDraftEntry } from "@/components/membership/timeline-model";

import styles from "./ruined-timeline.module.css";

type PreparedArtwork = {
  filename: string;
  pageIndex: number;
  url: string;
};

export default function TimelineExportStudio({
  entries,
  examples,
}: {
  entries: TimelineDraftEntry[];
  examples: boolean;
}) {
  const [formatId, setFormatId] = useState<TimelineArtworkFormatId>(
    DEFAULT_TIMELINE_ARTWORK_FORMAT,
  );
  const [pageIndex, setPageIndex] = useState(0);
  const [previewState, setPreviewState] = useState<"error" | "ready" | "rendering">(
    "rendering",
  );
  const [preparing, setPreparing] = useState(false);
  const [prepared, setPrepared] = useState<PreparedArtwork[]>([]);
  const [message, setMessage] = useState("");
  const previewRef = useRef<HTMLCanvasElement>(null);
  const paperPromiseRef = useRef<ReturnType<typeof loadTimelinePaper> | null>(null);
  const preparedRef = useRef<PreparedArtwork[]>([]);
  const preparationRef = useRef(0);
  const format = useMemo(() => getTimelineArtworkFormat(formatId), [formatId]);
  const pages = useMemo(() => paginateTimelineArtwork(entries, format), [entries, format]);
  const page = pages[Math.min(pageIndex, Math.max(0, pages.length - 1))] ?? null;
  const entryRevision = entries
    .map(
      (entry) =>
        `${entry.id ?? ""}:${entry.clientKey}:${entry.createdOrder}:${entry.year}:${entry.title}:${entry.details}`,
    )
    .join("|");

  function chooseFormat(nextFormat: TimelineArtworkFormatId) {
    setFormatId(nextFormat);
    setPageIndex(0);
  }

  function moveBetweenFormats(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (!["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    const nextIndex =
      (index + direction + TIMELINE_ARTWORK_FORMATS.length) %
      TIMELINE_ARTWORK_FORMATS.length;
    const next = TIMELINE_ARTWORK_FORMATS[nextIndex]!;
    chooseFormat(next.id);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(`[data-artwork-format-option="${next.id}"]`)
        ?.focus();
    });
  }

  useEffect(() => {
    setPageIndex((current) => Math.min(current, Math.max(0, pages.length - 1)));
  }, [pages.length]);

  useEffect(() => {
    preparationRef.current += 1;
    preparedRef.current.forEach(({ url }) => URL.revokeObjectURL(url));
    preparedRef.current = [];
    setPrepared([]);
    setPreparing(false);
    setMessage("");
  }, [entryRevision, examples, formatId]);

  useEffect(() => {
    return () => {
      preparationRef.current += 1;
      preparedRef.current.forEach(({ url }) => URL.revokeObjectURL(url));
      preparedRef.current = [];
    };
  }, []);

  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !page) return;
    let cancelled = false;
    setPreviewState("rendering");
    async function drawPreview() {
      try {
        paperPromiseRef.current ??= loadTimelinePaper();
        const [paper] = await Promise.all([
          paperPromiseRef.current,
          document.fonts.ready,
        ]);
        if (cancelled || !canvas) return;
        renderTimelineArtwork({
          canvas,
          entries,
          examples,
          fonts: readTimelineArtworkFonts(),
          format: previewTimelineArtworkFormat(format),
          page,
          paper,
        });
        if (!cancelled) setPreviewState("ready");
      } catch {
        if (!cancelled) setPreviewState("error");
      }
    }
    void drawPreview();
    return () => {
      cancelled = true;
    };
  }, [entries, entryRevision, examples, format, page]);

  async function prepareArtwork() {
    if (!page || preparing) return;
    const preparationId = preparationRef.current + 1;
    preparationRef.current = preparationId;
    preparedRef.current.forEach(({ url }) => URL.revokeObjectURL(url));
    preparedRef.current = [];
    setPrepared([]);
    setPreparing(true);
    setMessage(
      pages.length > 1
        ? `Preparing image 1 of ${pages.length}.`
        : "Preparing the full-resolution PNG.",
    );
    const nextPrepared: PreparedArtwork[] = [];
    const canvas = document.createElement("canvas");
    try {
      paperPromiseRef.current ??= loadTimelinePaper();
      const [paper] = await Promise.all([
        paperPromiseRef.current,
        document.fonts.ready,
      ]);
      const fonts = readTimelineArtworkFonts();
      for (const artworkPage of pages) {
        if (preparationRef.current !== preparationId) return;
        setMessage(
          pages.length > 1
            ? `Preparing image ${artworkPage.index + 1} of ${pages.length}.`
            : "Preparing the full-resolution PNG.",
        );
        renderTimelineArtwork({
          canvas,
          entries,
          examples,
          fonts,
          format,
          page: artworkPage,
          paper,
        });
        const blob = await canvasToPngBlob(canvas);
        if (preparationRef.current !== preparationId) return;
        nextPrepared.push({
          filename: timelineArtworkFilename({
            entries,
            examples,
            format,
            page: artworkPage,
          }),
          pageIndex: artworkPage.index,
          url: URL.createObjectURL(blob),
        });
      }
      if (preparationRef.current !== preparationId) return;
      canvas.width = 1;
      canvas.height = 1;
      preparedRef.current = nextPrepared;
      setPrepared(nextPrepared);
      setMessage(
        nextPrepared.length > 1
          ? `${nextPrepared.length} ${format.label.toLowerCase()} images are ready to download.`
          : `${format.label} image is ready to download.`,
      );
    } catch (error) {
      if (preparationRef.current === preparationId) {
        setMessage(
          error instanceof Error
            ? error.message
            : "The PNG could not be prepared.",
        );
      }
    } finally {
      canvas.width = 1;
      canvas.height = 1;
      if (preparedRef.current !== nextPrepared) {
        nextPrepared.forEach(({ url }) => URL.revokeObjectURL(url));
      }
      if (preparationRef.current === preparationId) setPreparing(false);
    }
  }

  if (!page) return null;

  return (
    <section aria-labelledby="timeline-export-title" className={styles.exportStudio} data-timeline-export-studio>
      <div className={styles.exportHeading}>
        <div>
          <p className={styles.kicker}>IMAGE</p>
          <h2 className={styles.uiHeading} id="timeline-export-title">Photo generator</h2>
        </div>
        <p className={styles.exportCopy}>
          Choose a format, preview it, and download the finished image.
        </p>
      </div>

      <div aria-label="Artwork format" className={styles.formatPicker} role="radiogroup">
        {TIMELINE_ARTWORK_FORMATS.map((option, index) => {
          const selected = option.id === formatId;
          return (
            <button
              aria-checked={selected}
              className={`${styles.formatOption} ${selected ? styles.formatOptionSelected : ""}`}
              data-artwork-format-option={option.id}
              key={option.id}
              onClick={() => chooseFormat(option.id)}
              onKeyDown={(event) => moveBetweenFormats(event, index)}
              role="radio"
              tabIndex={selected ? 0 : -1}
              type="button"
            >
              <span>{option.label}</span>
              <small>{option.dimensions}</small>
            </button>
          );
        })}
      </div>

      <div className={styles.exportWorkspace}>
        <div
          aria-busy={previewState === "rendering"}
          className={styles.artworkPreview}
          data-artwork-format={format.id}
        >
          <canvas aria-hidden="true" ref={previewRef} />
          {previewState === "rendering" ? <p>Drawing the ink.</p> : null}
          {previewState === "error" ? <p>The preview could not be drawn.</p> : null}
          <p className={styles.srOnly}>
            Timeline artwork preview, page {page.index + 1} of {page.total}, containing {page.entries.length} chronological events.
          </p>
        </div>

        <aside className={styles.exportRail}>
          <div>
            <p className={styles.kicker}>OUTPUT</p>
            <h3 className={styles.exportFormatName}>{format.label}</h3>
            <p className={styles.exportDimensions}>{format.dimensions}</p>
            {format.id === "carousel" ? (
              <p className={styles.exportFlowNote}>
                Horizontal trail · connected pages
              </p>
            ) : null}
          </div>

          {page.total > 1 ? (
            <div className={styles.pageControls}>
              <p>Page {String(page.index + 1).padStart(2, "0")} / {String(page.total).padStart(2, "0")}</p>
              <div>
                <button
                  aria-label="Previous artwork page"
                  disabled={page.index === 0}
                  onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                  type="button"
                >
                  ←
                </button>
                <button
                  aria-label="Next artwork page"
                  disabled={page.index === page.total - 1}
                  onClick={() => setPageIndex((current) => Math.min(page.total - 1, current + 1))}
                  type="button"
                >
                  →
                </button>
              </div>
            </div>
          ) : null}

          <div className={styles.exportActions}>
            <button
              aria-busy={preparing}
              className={`${styles.button} ${styles.primaryButton}`}
              disabled={preparing || previewState !== "ready"}
              onClick={prepareArtwork}
              type="button"
            >
              {preparing
                ? pages.length > 1
                  ? `Preparing ${pages.length} images`
                  : "Preparing PNG"
                : prepared.length
                  ? "Prepare again"
                  : pages.length > 1
                    ? `Prepare ${pages.length} images`
                    : "Prepare PNG"}
            </button>
            {prepared.map((artwork) => (
              <a
                aria-label={`Download ${format.label} image ${artwork.pageIndex + 1} of ${prepared.length} as PNG`}
                className={styles.downloadArtwork}
                download={artwork.filename}
                href={artwork.url}
                key={artwork.url}
              >
                {prepared.length > 1
                  ? `Download image ${String(artwork.pageIndex + 1).padStart(2, "0")} / ${String(prepared.length).padStart(2, "0")} ↓`
                  : "Download PNG ↓"}
              </a>
            ))}
            <p
              aria-atomic="true"
              aria-live="polite"
              className={styles.exportStatus}
              role="status"
            >
              {message}
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
