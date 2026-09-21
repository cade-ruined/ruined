export type MemberSessionStatus = "connected" | "reconnecting" | "offline" | "signed_out" | "account_changed";

/** Refreshes server-owned cookies without replacing the page or storing credentials. */
export function startMemberSessionMonitor({ ownerId, initialStatus, onStatus }: {
  ownerId?: string;
  initialStatus: MemberSessionStatus;
  onStatus: (status: MemberSessionStatus) => void;
}) {
  let status = initialStatus;
  let stopped = false;
  let sequence = 0;
  let lastChecked = -Infinity;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let pending: Promise<void> | undefined;

  const visible = () => document.visibilityState !== "hidden";
  function update(next: MemberSessionStatus) { status = next; onStatus(next); }
  function clearTimer() { clearTimeout(timer); timer = undefined; }
  function schedule(delay: number) {
    clearTimer();
    if (!stopped && visible() && navigator.onLine !== false) timer = setTimeout(() => { void check(true); }, delay);
  }
  function unavailable() {
    // Once credentials are invalid, a later network problem cannot restore access.
    if (status !== "signed_out") update(navigator.onLine === false ? "offline" : "reconnecting");
    schedule(Math.min(60_000, 5_000 * 2 ** Math.min(failures++, 4)));
  }
  function check(force = false): Promise<void> {
    if (stopped || status === "account_changed" || !visible()) return Promise.resolve();
    if (navigator.onLine === false) {
      clearTimer();
      if (status !== "signed_out") update("offline");
      return Promise.resolve();
    }
    if (!force && pending) return pending;
    if (!force && Date.now() - lastChecked < 30_000 && status === "connected") {
      schedule(5 * 60_000 - (Date.now() - lastChecked));
      return Promise.resolve();
    }
    clearTimer();
    controller?.abort();
    const request = new AbortController();
    controller = request;
    const current = ++sequence;
    const timeout = setTimeout(() => request.abort(), 10_000);
    lastChecked = Date.now();
    pending = (async () => {
      try {
        const response = await fetch("/api/auth/session", {
          method: "GET", credentials: "same-origin", cache: "no-store", signal: request.signal,
          headers: ownerId ? { "X-Ruined-Session-Owner": ownerId } : {},
        });
        const payload = await response.json() as { status?: string };
        if (stopped || current !== sequence || request.signal.aborted) return;
        if (response.status === 200 && payload.status === "authenticated") {
          failures = 0;
          update("connected");
          schedule(5 * 60_000);
        } else if (response.status === 401 && payload.status === "signed_out") {
          update("signed_out");
        } else if (response.status === 409 && payload.status === "account_changed") {
          update("account_changed");
        } else unavailable();
      } catch {
        if (!stopped && current === sequence) unavailable();
      } finally {
        clearTimeout(timeout);
        if (current === sequence) { pending = undefined; controller = undefined; }
      }
    })();
    return pending;
  }
  const wake = () => { void check(); };
  const visibility = () => { if (visible()) wake(); else clearTimer(); };
  const offline = () => {
    clearTimer();
    sequence++;
    controller?.abort();
    controller = undefined;
    pending = undefined;
    if (status !== "signed_out" && status !== "account_changed") update("offline");
  };
  window.addEventListener("focus", wake);
  window.addEventListener("pageshow", wake);
  window.addEventListener("online", wake);
  window.addEventListener("offline", offline);
  document.addEventListener("visibilitychange", visibility);
  void check();
  return {
    check: () => check(true),
    stop() {
      stopped = true;
      sequence++;
      clearTimer();
      controller?.abort();
      window.removeEventListener("focus", wake);
      window.removeEventListener("pageshow", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
