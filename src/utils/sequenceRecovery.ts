export type FrameLoadFailure = { count: number; retryAt: number };

// An unavailable frame is never permanently blacklisted. Back off during an
// outage without continuing a request storm or requiring a page refresh.
export function nextFrameLoadFailure(
  previous: FrameLoadFailure | undefined,
  now: number,
): FrameLoadFailure {
  const count = Math.min((previous?.count ?? 0) + 1, 7);
  return { count, retryAt: now + Math.min(500 * 2 ** (count - 1), 30_000) };
}

export function frameLoadReady(failure: FrameLoadFailure | undefined, now: number) {
  return !failure || now >= failure.retryAt;
}

export type SequenceFallbackSpan = {
  start: number;
  end: number;
  departure: string;
  arrival: string;
};

export function sequenceFallbackSpans(frames: readonly string[]): SequenceFallbackSpan[] {
  const spans: SequenceFallbackSpan[] = [];
  let group = "";
  for (const [index, frame] of frames.entries()) {
    const nextGroup = frame.split("?", 1)[0].split("/").slice(0, -1).join("/");
    if (nextGroup !== group || !spans.length) {
      const previous = spans.at(-1);
      // Use the exact next-room arrival asset shared by the mobile experience,
      // not a separately exported composition of the same room.
      if (previous) previous.arrival = frame;
      spans.push({ start: index, end: index, departure: frame, arrival: frame });
      group = nextGroup;
    } else {
      const span = spans[spans.length - 1];
      span.end = index;
      span.arrival = frame;
    }
  }
  return spans;
}

export function sequenceFallbackForFrame(spans: readonly SequenceFallbackSpan[], target: number) {
  const span = spans.find((candidate) => target >= candidate.start && target <= candidate.end);
  if (!span) return undefined;
  return target - span.start < (span.end - span.start) / 2 ? span.departure : span.arrival;
}

export const DESKTOP_JOURNEY_RETRY_BASE_MS = 400;
export const DESKTOP_JOURNEY_RETRY_MAX_MS = 4_000;
export const DESKTOP_JOURNEY_MAX_ATTEMPTS = 3;
export const DESKTOP_JOURNEY_LOAD_TIMEOUT_MS = 8_000;

export function desktopJourneyRetryDelay(attempt: number) {
  if (attempt + 1 >= DESKTOP_JOURNEY_MAX_ATTEMPTS) return null;
  return Math.min(DESKTOP_JOURNEY_RETRY_BASE_MS * 2 ** attempt, DESKTOP_JOURNEY_RETRY_MAX_MS);
}

// Dynamic imports cannot be aborted. Bound the combined import/manifest wait,
// ignore late results, and cancel this deadline when the component unmounts.
export function withSequenceLoadDeadline<T>(
  work: Promise<T>,
  signal: AbortSignal,
  timeoutMs = DESKTOP_JOURNEY_LOAD_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(() => reject(new Error("Walk loading timed out"))), timeoutMs);
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      complete();
    };
    const abort = () => finish(() => reject(new DOMException("Walk loading cancelled", "AbortError")));
    work.then((result) => finish(() => resolve(result)), (error: unknown) => finish(() => reject(error)));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}
