const READ_TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 300;

export type MemberReadResult = { status: number; ok: boolean; data: unknown };

export class MemberReadTimeoutError extends Error {
  constructor() {
    super("The member information could not finish loading.");
    this.name = "MemberReadTimeoutError";
  }
}

class InvalidMemberReadResponseError extends Error {}

function aborted() {
  return new DOMException("The member read was cancelled.", "AbortError");
}

function waitToRetry(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(aborted()); return; }
    const cancel = () => { clearTimeout(timer); reject(aborted()); };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, RETRY_DELAY_MS);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

async function readOnce(url: string, signal: AbortSignal): Promise<MemberReadResult> {
  if (signal.aborted) throw aborted();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    cancel = () => { clearTimeout(timer); reject(aborted()); controller.abort(); };
    signal.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => {
      reject(new MemberReadTimeoutError());
      controller.abort();
    }, READ_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) {
          // Access failures must remain access failures even if their body stalls.
          void response.body?.cancel().catch(() => {});
          return { status: response.status, ok: false, data: null };
        }
        let data: unknown = null;
        try { data = await response.json(); }
        catch (error) {
          if (error instanceof TypeError) throw error;
          throw new InvalidMemberReadResponseError("Invalid member read response.");
        }
        return { status: response.status, ok: response.ok, data };
      })(),
      interrupted,
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}

/** One automatic retry for a transient read failure; caller cancellation always wins. */
export async function fetchMemberRead(url: string, { signal }: { signal: AbortSignal }): Promise<MemberReadResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await readOnce(url, signal);
      if (signal.aborted) throw aborted();
      if (attempt === 1 || ![503, 504].includes(result.status)) return result;
    } catch (error) {
      if (signal.aborted) throw aborted();
      if (attempt === 1 || !(error instanceof TypeError || error instanceof MemberReadTimeoutError)) throw error;
    }
    await waitToRetry(signal);
  }
  throw new MemberReadTimeoutError();
}
