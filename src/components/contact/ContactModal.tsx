"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef } from "react";

import ContactSurface from "@/components/contact/ContactSurface";

export default function ContactModal() {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const previousOverflowRef = useRef("");
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();

    const focusFrame = requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });

    return () => {
      cancelAnimationFrame(focusFrame);
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflowRef.current;
      const previousFocus = previousFocusRef.current;
      const canRestorePreviousFocus = Boolean(
        previousFocus?.isConnected && previousFocus !== document.body,
      );
      const focusTarget = canRestorePreviousFocus
        ? previousFocus
        : document.querySelector<HTMLElement>("[data-contact-return-focus]");
      if (focusTarget) {
        requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
      }
    };
  }, []);

  const returnToRoom = () => router.back();

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        returnToRoom();
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) returnToRoom();
      }}
      className="fixed inset-0 z-[140] m-0 hidden h-dvh max-h-none w-screen max-w-none place-items-center overflow-y-auto bg-transparent p-0 text-[var(--color-faded)] backdrop:bg-black/75 open:grid sm:p-5"
    >
      <div className="grid h-dvh max-h-dvh w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-[var(--color-bone)] shadow-[0.7rem_0.7rem_0_var(--color-poster)] sm:h-auto sm:min-h-0 sm:max-h-[calc(100dvh-2.5rem)] sm:max-w-[72rem] sm:border sm:border-white/25">
        <header className="flex min-h-16 items-center justify-between gap-5 border-b border-black/20 px-5 sm:px-7">
          <p className="font-mono text-[0.55rem] uppercase tracking-[0.24em] text-black/50">
            Contact / The Ruined Project
          </p>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={returnToRoom}
            className="min-h-11 border border-black/35 px-4 font-mono text-[0.55rem] uppercase tracking-[0.18em] transition-colors hover:border-black hover:bg-black hover:text-[var(--color-bone)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
          >
            Return to room
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-10 sm:px-8 sm:py-12 lg:px-12 lg:py-14">
          <ContactSurface modal titleId={titleId} />
        </div>
      </div>
    </dialog>
  );
}
