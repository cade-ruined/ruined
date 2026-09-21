"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import PasswordlessAccessForm from "@/components/platform/PasswordlessAccessForm";
import { startMemberSessionMonitor, type MemberSessionStatus } from "@/lib/auth/member-session-monitor";
import styles from "./MemberSessionContinuity.module.css";

export default function MemberSessionContinuity({ children, enabled, ownerId, initiallyUnavailable = false }: {
  children: React.ReactNode;
  enabled: boolean;
  ownerId?: string;
  initiallyUnavailable?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<MemberSessionStatus>(initiallyUnavailable ? "reconnecting" : "connected");
  const [codeAccepted, setCodeAccepted] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const monitor = useRef<ReturnType<typeof startMemberSessionMonitor> | null>(null);
  const recovered = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    recovered.current = false;
    const connection = startMemberSessionMonitor({
      ownerId,
      initialStatus: initiallyUnavailable ? "reconnecting" : "connected",
      onStatus(next) {
        setStatus(next);
        if (next === "signed_out") {
          setCodeAccepted(false);
          if (dialog.current && !dialog.current.open) dialog.current.showModal();
        }
        if (next === "connected") {
          setCodeAccepted(false);
          dialog.current?.close();
          // Only a page that could not initially authenticate needs new server content.
          // An existing member's forms stay mounted during all ordinary renewals.
          if (!ownerId && initiallyUnavailable && !recovered.current) {
            recovered.current = true;
            router.refresh();
          }
        }
        if (next === "account_changed") {
          dialog.current?.close();
          // A hidden modal still makes the rest of the document inert. Release
          // the old account's top-layer dialogs before concealing its content.
          content.current?.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach(modal => modal.close());
        }
      },
    });
    monitor.current = connection;
    return () => { connection.stop(); monitor.current = null; };
  }, [enabled, ownerId, initiallyUnavailable, router]);

  const changed = enabled && status === "account_changed";
  const notice = enabled && status !== "connected";
  return <>
    <div ref={content} hidden={changed} inert={changed ? true : undefined}>{children}</div>
    {notice ? <aside className={styles.notice} aria-live="polite" aria-atomic="true">
      <p>{status === "offline" ? "You’re offline. Keep this page open to keep your unfinished work." :
        status === "reconnecting" ? ownerId ? "Reconnecting to Ruined. Your unfinished work is still here." : "Reconnecting to Ruined. Please keep this page open." :
        status === "signed_out" ? "Sign in again to continue. Your unfinished work will stay here." :
        "A different account is now signed in. Open its profile to continue."}</p>
      {changed ? <button type="button" onClick={() => window.location.assign("/my")}>Open profile</button> :
        status === "signed_out" ? <button type="button" onClick={() => dialog.current?.showModal()}>Sign in</button> :
        <button type="button" onClick={() => { void monitor.current?.check(); }}>Try again</button>}
    </aside> : null}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="member-session-title">
      <div className={styles.heading}><h2 id="member-session-title">Welcome back.</h2><button type="button" onClick={() => dialog.current?.close()} aria-label="Close sign-in">×</button></div>
      <p>Sign in to the same account to pick up where you left off.</p>
      {codeAccepted ? <div><p role="status">Your code was accepted. We’re reconnecting to your account.</p><button className={styles.retry} type="button" onClick={() => { void monitor.current?.check(); }}>Try again</button></div> :
        <PasswordlessAccessForm enabled={enabled} returnTo={pathname} onAuthenticated={async () => { setCodeAccepted(true); await monitor.current?.check(); }} />}
    </dialog>
  </>;
}
