"use client";

import { Children, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

const views = [
  { id: "overview", label: "Overview" },
  { id: "membership", label: "Membership" },
  { id: "journey", label: "Journey" },
  { id: "community", label: "Community" },
  { id: "record", label: "Record" },
] as const;
type View = typeof views[number]["id"];
type Destination = { view: View; hash: string; scroll: boolean };

export default function OperatorMemberWorkspace({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<View>("overview");
  const [review, setReview] = useState<Destination | null>(null);
  const [notice, setNotice] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const activeRef = useRef<View>(active);
  const dirtyForms = useRef(new Set<HTMLFormElement>());
  activeRef.current = active;

  const applyDestination = useCallback((destination: Destination) => {
    setReview(null);
    setNotice("");
    activeRef.current = destination.view;
    setActive(destination.view);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}${destination.hash}`);
    if (destination.scroll) requestAnimationFrame(() => document.getElementById(destination.hash.slice(1))?.scrollIntoView({ block: "nearest" }));
  }, []);

  const requestDestination = useCallback((destination: Destination) => {
    if (destination.view === activeRef.current) { applyDestination(destination); return; }
    if (root.current?.querySelector('[data-operator-pending="true"]')) {
      setNotice("Wait for the current save to finish before switching views.");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${activeRef.current}`);
      return;
    }
    const panel = root.current?.querySelector(`[data-member-view="${activeRef.current}"]`);
    const dirty = [...dirtyForms.current].some((form) => form.isConnected && panel?.contains(form));
    if (dirty || panel?.querySelector('[data-operator-dirty="true"]')) {
      setReview(destination);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${activeRef.current}`);
      return;
    }
    applyDestination(destination);
  }, [applyDestination]);

  useEffect(() => {
    let mounted = true;
    if (!window.location.hash) {
      // Next focuses the new main after navigation. Reveal it below the sticky
      // operator navigation once that focus/scroll pass has finished.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (mounted && !window.location.hash) document.getElementById("operator-content")?.scrollIntoView({ block: "start" });
      }));
    }
    function followHash() {
      const hash = window.location.hash;
      if (!hash) return;
      const target = document.getElementById(hash.slice(1));
      const panel = target?.closest<HTMLElement>("[data-member-view]");
      const view = views.find((item) => item.id === panel?.dataset.memberView)?.id;
      if (view && root.current?.contains(target)) requestDestination({ view, hash, scroll: true });
    }
    followHash();
    window.addEventListener("hashchange", followHash);
    return () => {
      mounted = false;
      window.removeEventListener("hashchange", followHash);
    };
  }, [requestDestination]);

  return <div ref={root} onChangeCapture={(event) => {
    if (event.target instanceof Element) {
      const form = event.target.closest("form");
      if (form) dirtyForms.current.add(form);
    }
  }} onResetCapture={(event) => {
    if (event.target instanceof HTMLFormElement) dirtyForms.current.delete(event.target);
  }}>
    <nav aria-label="Member record sections" className="no-scrollbar mt-3 flex max-w-full gap-1 overflow-x-auto rounded-[8px] bg-black/[0.045] p-1">
      {views.map((view) => <button aria-pressed={active === view.id} aria-controls={`member-view-${view.id}`} key={view.id} className={`min-h-11 shrink-0 rounded-[4px] px-4 text-sm font-semibold transition ${active === view.id ? "bg-[var(--color-bone)] text-black shadow-sm" : "text-black/55 hover:text-black"}`} onClick={() => requestDestination({ view: view.id, hash: `#${view.id}`, scroll: false })} type="button">{view.label}</button>)}
    </nav>
    {notice ? <p className="mt-3 text-sm text-[var(--color-poster)]" role="status">{notice}</p> : null}
    {review ? <div className="mt-3 rounded-[4px] bg-[var(--color-highlight)]/30 p-3 text-sm" role="group" aria-live="polite" aria-label="Keep unsaved edits?">
      <p>Your edits in {views.find((view) => view.id === active)?.label} are not saved. They will stay here if you switch.</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <button className="min-h-11 px-2 font-semibold" type="button" onClick={() => setReview(null)}>Keep editing</button>
        <button className="min-h-11 px-2 underline underline-offset-4" type="button" onClick={() => {
          if (root.current?.querySelector('[data-operator-pending="true"]')) { setNotice("Wait for the current save to finish before switching views."); return; }
          applyDestination(review);
        }}>Switch view — keep edits</button>
      </div>
    </div> : null}
    {Children.toArray(children).map((panel, index) => <div data-member-view={views[index]?.id} hidden={active !== views[index]?.id} id={`member-view-${views[index]?.id}`} key={views[index]?.id ?? index} className="pt-3">{panel}</div>)}
  </div>;
}
