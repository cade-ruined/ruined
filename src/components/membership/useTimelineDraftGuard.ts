"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTimelineDraftStore, type TimelineDraftCheckpoint } from "./MemberTimelineDraftState";
import type { TimelineFormValue } from "./timeline-model";

type DraftState = {
  enabled: boolean;
  dirty: boolean;
  pending: boolean;
  form: TimelineFormValue;
  baseline: TimelineFormValue;
  editingEntryId: string | null;
  revision: string;
};

function checkpoint(state: DraftState): TimelineDraftCheckpoint {
  return { form: state.form, baseline: state.baseline, editingEntryId: state.editingEntryId, revision: state.revision, wasPending: state.pending };
}

function sameForm(left: TimelineFormValue, right: TimelineFormValue) {
  return left.year === right.year && left.month === right.month && left.title === right.title && left.details === right.details;
}

function sameDraft(left: DraftState | null, right: DraftState) {
  return left !== null && left.editingEntryId === right.editingEntryId && left.revision === right.revision
    && left.pending === right.pending && sameForm(left.form, right.form) && sameForm(left.baseline, right.baseline);
}

/** Links that leave this document, excluding a new tab, download, or hash jump. */
export function timelineNavigationTarget(event: MouseEvent, currentUrl: string): URL | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const target = event.target;
  if (!(target instanceof Element)) return null;
  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || anchor.hasAttribute("download")) return null;
  const browsingTarget = anchor.getAttribute("target")?.toLowerCase();
  if (browsingTarget && browsingTarget !== "_self") return null;
  try {
    const current = new URL(currentUrl);
    const next = new URL(anchor.href, current);
    if (!["http:", "https:"].includes(next.protocol)) return null;
    if (next.origin === current.origin && next.pathname === current.pathname && next.search === current.search) return null;
    return next;
  } catch {
    return null;
  }
}

export function useTimelineDraftGuard(state: DraftState) {
  const store = useTimelineDraftStore();
  const writer = useRef(Symbol("timeline-draft"));
  const latest = useRef(state);
  latest.current = state;
  const currentStore = useRef(store);
  currentStore.current = store;
  const cleared = useRef<DraftState | null>(null);
  const [recovery, setRecovery] = useState(() => ({ store, record: state.enabled ? store?.read() ?? null : null }));
  const recoveryRecord = recovery.store === store ? recovery.record : null;

  useEffect(() => {
    const record = state.enabled ? store?.read() ?? null : null;
    setRecovery({ store, record: record?.writer === writer.current ? null : record });
  }, [store, state.enabled]);

  useEffect(() => {
    if (state.enabled && (state.dirty || state.pending) && !sameDraft(cleared.current, state)) store?.write(writer.current, checkpoint(state));
    else store?.clear(writer.current);
    // Do not clear on unmount: Back/Forward and programmatic navigation need
    // the checkpoint. The enclosing member layout owns its lifetime.
  }, [store, state]);

  useEffect(() => {
    if (!state.enabled) return;
    const active = () => currentStore.current === store && !sameDraft(cleared.current, latest.current)
      && latest.current.enabled && (latest.current.dirty || latest.current.pending);
    const remember = () => store?.write(writer.current, checkpoint(latest.current));
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!active()) return;
      remember();
      event.preventDefault();
      event.returnValue = "";
    }
    function click(event: MouseEvent) {
      if (!active()) return;
      const next = timelineNavigationTarget(event, window.location.href);
      if (!next) return;
      remember();
      // External navigations get the browser's beforeunload dialog. Next's
      // same-origin navigation needs a prompt before its click handler runs.
      if (next.origin !== window.location.origin) return;
      const staysInMemberArea = next.pathname === "/my" || (next.pathname.startsWith("/my/") && next.pathname !== "/my/access");
      const message = latest.current.pending
        ? "A Timeline change is still saving. Leave anyway? Check the saved events when you return."
        : staysInMemberArea
          ? "Leave this Timeline? Your unfinished entry will be kept while you move around the member area."
          : "Leave the member area? Your unfinished Timeline entry will be lost. Stay to keep working.";
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    document.addEventListener("click", click, true);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      document.removeEventListener("click", click, true);
      window.removeEventListener("beforeunload", beforeUnload);
      if (active()) remember();
    };
  }, [store, state.enabled]);

  const dismissRecovery = useCallback(() => {
    if (currentStore.current !== store) return;
    if (recoveryRecord) store?.clear(recoveryRecord.writer);
    setRecovery({ store, record: null });
  }, [store, recoveryRecord]);
  const clearDraft = useCallback(() => {
    if (currentStore.current !== store) return;
    cleared.current = { ...latest.current, form: { ...latest.current.form }, baseline: { ...latest.current.baseline } };
    store?.clear(writer.current);
    if (recoveryRecord) store?.clear(recoveryRecord.writer);
    setRecovery({ store, record: null });
  }, [store, recoveryRecord]);

  return {
    recoveryDraft: state.enabled ? recoveryRecord?.draft ?? null : null,
    dismissRecovery,
    clearDraft,
  };
}

export default useTimelineDraftGuard;
