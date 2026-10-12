"use client";

import { useEffect, useId, useRef, useState } from "react";

import styles from "./InstallRuined.module.css";

type InstallChoice = { outcome: "accepted" | "dismissed" };
type InstallPrompt = Event & {
  prompt: () => Promise<InstallChoice | void>;
  userChoice?: Promise<InstallChoice>;
};
type Device = "ios" | "android" | "other";

const HANDLED_KEY = "ruined-member-install-handled";
const DISMISSAL_KEY = "ruined-member-install-dismissed-until";
const DISMISSAL_DURATION = 30 * 24 * 60 * 60 * 1000;
// A blocked storage write must still survive component remounts in this visit.
let handledThisVisit = false;

function rememberHandled() {
  handledThisVisit = true;
  try {
    window.localStorage.setItem(HANDLED_KEY, "true");
  } catch {
    // The browser may prevent persistence; keep the visit-level fallback above.
  }
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(DISMISSAL_KEY, String(Date.now() + DISMISSAL_DURATION));
  } catch {
    // Not now still dismisses the current control when storage is unavailable.
  }
}

export default function InstallRuined({ className, variant = "suggestion" }: { className?: string; variant?: "suggestion" | "profile" }) {
  const instructionsId = useId();
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [handled, setHandled] = useState(false);
  const [device, setDevice] = useState<Device>("other");
  const [showInstructions, setShowInstructions] = useState(false);
  const instructions = useRef<HTMLDivElement>(null);
  const installPrompt = useRef<InstallPrompt | null>(null);
  const promptPending = useRef(false);
  const alreadyHandled = useRef(false);

  useEffect(() => {
    const agent = navigator.userAgent;
    const desktop = /Windows|CrOS|X11/.test(agent);
    const ios = /iPad|iPhone|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1);
    const detected = desktop ? "other" : ios ? "ios" : /Android/.test(agent) ? "android" : "other";
    setDevice(detected);
    setReady(true);
    if (detected === "other") return;

    const standalone = window.matchMedia("(display-mode: standalone)");
    const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const updateInstalled = () => setInstalled(standalone.matches || iosStandalone);
    updateInstalled();

    let savedHandled = handledThisVisit;
    try {
      savedHandled ||= window.localStorage.getItem(HANDLED_KEY) === "true";
      setDismissed(Number(window.localStorage.getItem(DISMISSAL_KEY)) > Date.now());
    } catch {
      // Installation and manual steps remain usable when storage is blocked.
    }
    alreadyHandled.current = savedHandled;
    setHandled(savedHandled);

    const capturePrompt = (event: Event) => {
      const prompt = event as InstallPrompt;
      if (typeof prompt.prompt !== "function") return;
      event.preventDefault();
      if (!alreadyHandled.current && !handledThisVisit) installPrompt.current = prompt;
    };
    const finishInstall = () => {
      installPrompt.current = null;
      alreadyHandled.current = true;
      setInstalled(true);
      setHandled(true);
      setShowInstructions(false);
      rememberHandled();
    };
    standalone.addEventListener("change", updateInstalled);
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", finishInstall);

    return () => {
      standalone.removeEventListener("change", updateInstalled);
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", finishInstall);
      installPrompt.current = null;
    };
  }, []);

  useEffect(() => {
    if (showInstructions) instructions.current?.focus();
  }, [showInstructions]);

  async function install() {
    if (promptPending.current || alreadyHandled.current || device === "other") return;
    // The first deliberate click handles the suggestion, regardless of whether
    // the browser accepts, dismisses, or fails to open its native installer.
    alreadyHandled.current = true;
    setHandled(true);
    rememberHandled();
    const prompt = installPrompt.current;
    installPrompt.current = null;
    if (!prompt) {
      setShowInstructions(true);
      return;
    }

    // Browsers permit each saved prompt to be used only once, on a user gesture.
    promptPending.current = true;
    try {
      const result = await prompt.prompt();
      const choice = prompt.userChoice ? await prompt.userChoice : result;
      if (choice?.outcome === "accepted") setInstalled(true);
      else setShowInstructions(true);
    } catch {
      setShowInstructions(true);
    } finally {
      promptPending.current = false;
    }
  }

  if (!ready || device === "other" || installed || dismissed || (handled && !showInstructions)) return null;

  return (
    <section className={[styles.install, variant === "profile" ? styles.profile : null, className].filter(Boolean).join(" ")} aria-label="Install Ruined">
      {showInstructions ? (
        <div className={styles.instructions} id={instructionsId} ref={instructions} tabIndex={-1} aria-labelledby={`${instructionsId}-title`}>
          <div className={styles.instructionsHeader}>
            <h2 id={`${instructionsId}-title`}>Add Ruined to your home screen.</h2>
            <button type="button" className={styles.dismissButton} onClick={() => setShowInstructions(false)}>Done</button>
          </div>
          {device === "ios" ? (
            <ol>
              <li>Sign in to Ruined in Safari first.</li>
              <li>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</li>
              <li>Keep <strong>Open as Web App</strong> on if shown, then tap <strong>Add</strong>.</li>
            </ol>
          ) : (
            <ol>
              <li>Sign in to Ruined in your browser first.</li>
              <li>Open the browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
              <li>Confirm, then open Ruined from its icon.</li>
            </ol>
          )}
          <p>You may be asked to sign in once when you first open the app.</p>
        </div>
      ) : (
        <div className={styles.summary}>
          <div className={styles.copy}>
            <p className={styles.title}>{variant === "profile" ? "Ruined, on your home screen." : "Keep Ruined close."}</p>
            {variant !== "profile" ? <p>Open your membership from your home screen.</p> : null}
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.installButton} onClick={install} aria-expanded={false} aria-controls={instructionsId}>Install Ruined</button>
            {variant !== "profile" ? <button type="button" className={styles.dismissButton} onClick={() => { setDismissed(true); rememberDismissal(); }} aria-label="Dismiss install suggestion">Not now</button> : null}
          </div>
        </div>
      )}
    </section>
  );
}
