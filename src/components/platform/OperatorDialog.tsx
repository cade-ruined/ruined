"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** A focused operator workspace. Native dialog keeps the underlying page inert. */
export default function OperatorDialog({ open, title, context, children, onClose, pending = false, returnFocusId }: {
  open: boolean;
  title: string;
  context?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  pending?: boolean;
  returnFocusId?: string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const editFocusRef = useRef<Element | null>(null);
  const navigationRef = useRef<(() => void) | null>(null);
  const allowNavigationRef = useRef(false);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [savingNotice, setSavingNotice] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      // Route changes can replace the original card while the dialog closes.
      requestAnimationFrame(() => {
        const target = returnFocusId ? document.getElementById(returnFocusId) : previousFocus;
        if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
      });
    };
  }, [open, returnFocusId]);

  useEffect(() => {
    if (confirmDiscard) keepEditingRef.current?.focus();
  }, [confirmDiscard]);

  function isSaving() {
    return pendingRef.current || !!dialogRef.current?.querySelector('[data-operator-pending="true"]');
  }
  function finishClose() {
    if (isSaving()) { setSavingNotice(true); return; }
    setConfirmDiscard(false);
    setSavingNotice(false);
    const navigate = navigationRef.current;
    navigationRef.current = null;
    if (navigate) {
      requestAnimationFrame(() => {
        if (isSaving()) { setSavingNotice(true); return; }
        allowNavigationRef.current = true;
        try { navigate(); } finally { allowNavigationRef.current = false; }
      });
    } else onClose();
  }
  function requestClose(navigate?: () => void) {
    if (isSaving()) { setSavingNotice(true); return; }
    navigationRef.current = navigate ?? null;
    if (dialogRef.current?.querySelector('[data-operator-dirty="true"]')) {
      editFocusRef.current = document.activeElement;
      setConfirmDiscard(true);
      return;
    }
    finishClose();
  }

  return <dialog ref={dialogRef} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); requestClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget) requestClose(); }}
    onClickCapture={(event) => {
      if (allowNavigationRef.current || !(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download") || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const destination = new URL(link.href, window.location.href);
      if (!["http:", "https:"].includes(destination.protocol)) return;
      if (destination.origin === window.location.origin && destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash) return;
      if (!isSaving() && !dialogRef.current?.querySelector('[data-operator-dirty="true"]')) return;
      event.preventDefault(); event.stopPropagation();
      requestClose(() => { if (link.isConnected) link.click(); });
    }}
    onSubmitCapture={(event) => {
      if (allowNavigationRef.current || !(event.target instanceof HTMLFormElement) || !event.target.hasAttribute("action") || event.target.method !== "get") return;
      if (!isSaving() && !dialogRef.current?.querySelector('[data-operator-dirty="true"]')) return;
      event.preventDefault(); event.stopPropagation();
      const form = event.target;
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      requestClose(() => { if (form.isConnected) form.requestSubmit(submitter?.isConnected ? submitter : undefined); });
    }}
    className="operator-paper fixed inset-0 m-auto max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-5xl overflow-hidden rounded-[12px] border-0 bg-[var(--color-bone)] p-0 text-[var(--color-faded)] shadow-2xl backdrop:bg-black/55 sm:max-h-[calc(100dvh-3rem)] sm:w-[calc(100%-3rem)]">
    <div className="flex max-h-[calc(100dvh-1rem)] flex-col sm:max-h-[calc(100dvh-3rem)]">
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"><h2 id={titleId} className="operator-record-title">{title}</h2>{context}</div>
        <button ref={closeRef} type="button" aria-label={`Close ${title} management`} disabled={pending} onClick={() => requestClose()} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[4px] text-2xl hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40"><span aria-hidden="true">×</span></button>
      </header>
      {savingNotice ? <p role="status" className="px-5 pb-3 text-sm sm:px-7">Wait for the current save to finish before closing.</p> : null}
      {confirmDiscard ? <div role="alertdialog" aria-label="Discard unsaved changes?" aria-describedby={`${titleId}-discard`} className="mx-5 mb-4 rounded-[4px] bg-[var(--color-highlight)]/45 p-4 sm:mx-7">
        <p id={`${titleId}-discard`} className="text-sm">Discard unsaved changes?</p>
        <div className="mt-2 flex flex-wrap gap-2"><button ref={keepEditingRef} type="button" onClick={() => { setConfirmDiscard(false); navigationRef.current = null; requestAnimationFrame(() => { const target = editFocusRef.current; if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true }); }); }} className="min-h-11 rounded-[4px] bg-[var(--color-faded)] px-3 text-sm text-[var(--color-bone)]">Keep editing</button><button type="button" onClick={finishClose} className="min-h-11 px-3 text-sm underline underline-offset-4">Discard changes</button></div>
      </div> : null}
      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-5 sm:px-5" inert={confirmDiscard ? true : undefined}>{children}</div>
    </div>
  </dialog>;
}
