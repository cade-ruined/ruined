"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import OperatorDialog from "@/components/platform/OperatorDialog";
import { OpsInvitationActions } from "@/components/platform/OpsActions";
import { OPERATOR_PRIMARY_ACTION_CLASS } from "@/components/platform/operatorStyles";

/** Keep browsing people separate from changing their access. */
export default function OperatorPeopleWorkspace({ children, pendingJoining, preview = false }: {
  children: ReactNode;
  pendingJoining?: ReactNode;
  preview?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"members" | "pending">("members");
  const [adding, setAdding] = useState(false);
  const [navigationNotice, setNavigationNotice] = useState("");
  const pendingPanel = useRef<HTMLDivElement>(null);
  function switchView(next: "members" | "pending") {
    if (pendingPanel.current?.querySelector('[data-operator-pending="true"]')) {
      setNavigationNotice("Wait for the current change to finish before switching views.");
      return;
    }
    setNavigationNotice("");
    setView(next);
  }
  useEffect(() => {
    const readHash = () => {
      if (window.location.hash === "#allow-member-email" && pendingJoining) setAdding(true);
      if (window.location.hash === "#pending-member-joining" && pendingJoining) setView("pending");
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, [pendingJoining]);
  function close() {
    setAdding(false);
    if (window.location.hash === "#allow-member-email") window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return <div className="mx-auto max-w-[88rem]">
    <header className="operator-record-header mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 className="operator-page-heading">Members</h2>
      {pendingJoining ? <button className={OPERATOR_PRIMARY_ACTION_CLASS} id="add-member-trigger" onClick={() => setAdding(true)} type="button">Add member</button> : null}
    </header>
    {pendingJoining ? <nav className="mb-3 flex gap-1" aria-label="Member directory views">
      {([['members', 'Members'], ['pending', 'Pending joining']] as const).map(([key, label]) => <button type="button" key={key} aria-controls={key === "members" ? "member-directory-panel" : "pending-joining-panel"} aria-pressed={view === key} onClick={() => switchView(key)} className={`min-h-11 rounded-[4px] px-4 text-sm font-medium ${view === key ? 'bg-black/[0.08] text-black' : 'text-black/60 hover:bg-black/[0.04]'}`}>{label}</button>)}
    </nav> : null}
    {navigationNotice ? <p className="mb-4 text-sm" role="status">{navigationNotice}</p> : null}
    <div hidden={view === "pending" && Boolean(pendingJoining)} id="member-directory-panel">{children}</div>
    {pendingJoining ? <div hidden={view !== "pending"} id="pending-joining-panel" ref={pendingPanel}>{pendingJoining}</div> : null}
    {adding && pendingJoining ? <OperatorDialog open title="Add member" onClose={close} returnFocusId="add-member-trigger">
      <div id="allow-member-email"><OpsInvitationActions preview={preview} onSaved={() => router.refresh()} /></div>
    </OperatorDialog> : null}
  </div>;
}
