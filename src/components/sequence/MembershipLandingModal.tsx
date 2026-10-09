"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { getMembershipEmbedOrigin, readMembershipMessage } from "@/lib/membership-modal";
import styles from "./MembershipLandingModal.module.css";

export default function MembershipLandingModal({ onClose, returnFocus }: {
  onClose: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const origin = getMembershipEmbedOrigin();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    closeButton.current?.focus({ preventScroll: true });
    const trigger = returnFocus.current;
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      trigger?.focus({ preventScroll: true });
    };
  }, [returnFocus]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const message = readMembershipMessage(event, frame.current?.contentWindow ?? null, origin);
      if (message?.type === "ready") setReady(true);
      if (message?.type === "close") close.current();
      if (message?.type === "navigate") window.location.assign(message.destination);
    };
    window.addEventListener("message", receive);
    const timer = window.setTimeout(() => setSlow(true), 12000);
    return () => {
      window.removeEventListener("message", receive);
      window.clearTimeout(timer);
    };
  }, [origin]);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-modal="true"
      data-lenis-prevent
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className={styles.panel}>
        <header className={styles.toolbar}>
          <h2 id={titleId}>Ruined Membership</h2>
          <a className={styles.external} href={`${origin}/membership`} target="_blank" rel="noopener noreferrer">
            Open full page <span aria-hidden="true">↗</span>
          </a>
          <button ref={closeButton} className={styles.close} onClick={onClose} type="button" aria-label="Close membership preview">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.5" /></svg>
          </button>
        </header>
        <div className={styles.content}>
          {!ready && <div className={styles.loading} role="status">
            <p>{slow ? "Taking a little longer to load." : "Opening membership…"}</p>
            {slow && <a href={`${origin}/membership`} target="_blank" rel="noopener noreferrer">Open the membership page ↗</a>}
          </div>}
          <iframe
            ref={frame}
            className={`${styles.frame} ${ready ? styles.ready : ""}`}
            src={`${origin}/membership/embed`}
            title="Explore Ruined Membership"
            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
            allow="autoplay; fullscreen"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </div>
    </dialog>
  );
}
