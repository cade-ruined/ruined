"use client";

import { useEffect, useId, useRef, useState } from "react";

import styles from "./InstallRuined.module.css";

type InstallChoice = { outcome: "accepted" | "dismissed" };
type InstallPrompt = Event & {
  prompt: () => Promise<InstallChoice | void>;
  userChoice?: Promise<InstallChoice>;
};
type Device = "ios" | "android" | "mac" | "other";

const DISMISSAL_KEY = "ruined-member-install-dismissed-until";
const DISMISSAL_DURATION = 30 * 24 * 60 * 60 * 1000;

function rememberDismissal() {
  try {
    window.localStorage.setItem(DISMISSAL_KEY, String(Date.now() + DISMISSAL_DURATION));
  } catch {
    // The control still dismisses for this visit when storage is unavailable.
  }
}

export default function InstallRuined({ className }: { className?: string }) {
  const instructionsId = useId();
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [device, setDevice] = useState<Device>("other");
  const [showInstructions, setShowInstructions] = useState(false);
  const [openingPrompt, setOpeningPrompt] = useState(false);
  const installPrompt = useRef<InstallPrompt | null>(null);
  const promptPending = useRef(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)");
    const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const updateInstalled = () => setInstalled(standalone.matches || iosStandalone);
    updateInstalled();

    const agent = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1);
    setDevice(ios ? "ios" : /Android/.test(agent) ? "android" : /Macintosh/.test(agent) ? "mac" : "other");
    try {
      setDismissed(Number(window.localStorage.getItem(DISMISSAL_KEY)) > Date.now());
    } catch {
      // Private browsing can restrict storage without preventing installation.
    }

    const capturePrompt = (event: Event) => {
      const prompt = event as InstallPrompt;
      if (typeof prompt.prompt !== "function") return;
      event.preventDefault();
      installPrompt.current = prompt;
    };
    const finishInstall = () => {
      installPrompt.current = null;
      setInstalled(true);
      rememberDismissal();
    };
    standalone.addEventListener("change", updateInstalled);
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", finishInstall);
    setReady(true);

    return () => {
      standalone.removeEventListener("change", updateInstalled);
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", finishInstall);
      installPrompt.current = null;
    };
  }, []);

  async function install() {
    if (promptPending.current) return;
    const prompt = installPrompt.current;
    if (!prompt) {
      setShowInstructions(current => !current);
      return;
    }

    // Browsers permit each saved prompt to be used only once, on a user gesture.
    installPrompt.current = null;
    promptPending.current = true;
    setOpeningPrompt(true);
    try {
      const result = await prompt.prompt();
      const choice = prompt.userChoice ? await prompt.userChoice : result;
      if (choice?.outcome === "accepted") {
        setDismissed(true);
        rememberDismissal();
      } else {
        setShowInstructions(true);
      }
    } catch {
      setShowInstructions(true);
    } finally {
      promptPending.current = false;
      setOpeningPrompt(false);
    }
  }

  if (!ready || installed || dismissed) return null;

  return (
    <section className={[styles.install, className].filter(Boolean).join(" ")} aria-label="Install Ruined">
      <div className={styles.summary}>
        <div className={styles.copy}>
          <p className={styles.title}>Keep Ruined close.</p>
          <p>Open your membership from your home screen.</p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.installButton} onClick={install} disabled={openingPrompt} aria-expanded={showInstructions} aria-controls={instructionsId}>
            {openingPrompt ? "Opening…" : "Install Ruined"}
          </button>
          <button type="button" className={styles.dismissButton} onClick={() => { setDismissed(true); rememberDismissal(); }} aria-label="Dismiss install suggestion">
            Not now
          </button>
        </div>
      </div>
      {showInstructions ? (
        <div className={styles.instructions} id={instructionsId}>
          {device === "ios" ? (
            <ol>
              <li>Sign in to Ruined in Safari first.</li>
              <li>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</li>
              <li>Keep <strong>Open as Web App</strong> on if shown, then tap <strong>Add</strong>.</li>
            </ol>
          ) : device === "android" ? (
            <ol>
              <li>Sign in to Ruined in your browser first.</li>
              <li>Open the browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>
              <li>Confirm, then open Ruined from its icon.</li>
            </ol>
          ) : (
            <ol>
              <li>Sign in to Ruined in your browser first.</li>
              <li>{device === "mac" ? <>In Safari, choose <strong>File → Add to Dock</strong>. In Chrome or Edge, use the install icon in the address bar.</> : <>In Chrome or Edge, use the install icon in the address bar or choose <strong>Install</strong> from the browser menu.</>}</li>
              <li>If your browser has no install option, open Ruined in Chrome, Edge{device === "mac" ? ", or Safari" : ""}.</li>
            </ol>
          )}
          <p>You may be asked to sign in once when you first open the app.</p>
        </div>
      ) : null}
    </section>
  );
}
