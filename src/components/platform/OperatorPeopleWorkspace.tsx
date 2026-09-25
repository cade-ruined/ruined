"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import OperatorDialog from "@/components/platform/OperatorDialog";
import { OpsInvitationActions } from "@/components/platform/OpsActions";
import { OPERATOR_PRIMARY_ACTION_CLASS } from "@/components/platform/operatorStyles";

/** Keep browsing people separate from changing their access. */
export default function OperatorPeopleWorkspace({ children, pendingJoining, directInvitations, preview = false, showHistory = false }: {
  children: ReactNode;
  pendingJoining?: ReactNode;
  directInvitations?: ReactNode;
  preview?: boolean;
  showHistory?: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<"members" | "pending" | "direct">("members");
  const [adding, setAdding] = useState(false);
  const [navigationNotice, setNavigationNotice] = useState("");
  const pendingPanel = useRef<HTMLDivElement>(null);
  function switchView(next: "members" | "pending" | "direct") {
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
      if (window.location.hash === "#direct-invitations" && directInvitations) setView("direct");
    };
    readHash();
    window.addEventListener("hashchange", readHash);
    return () => window.removeEventListener("hashchange", readHash);
  }, [pendingJoining, directInvitations]);
  function close() {
    setAdding(false);
    if (window.location.hash === "#allow-member-email") window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return <div className="mx-auto max-w-[88rem]">
    <header className="operator-record-header mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 className="operator-page-heading">Members</h2>
      <div className="flex flex-wrap items-center gap-3">
        {showHistory ? <Link className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4" href="/ops/members/history" onClick={(event) => {
          if (pendingPanel.current?.querySelector('[data-operator-pending="true"]')) {
            event.preventDefault();
            setNavigationNotice("Wait for the current change to finish before switching views.");
          }
        }}>Historical members</Link> : null}
        {pendingJoining ? <button className={OPERATOR_PRIMARY_ACTION_CLASS} id="add-member-trigger" onClick={() => setAdding(true)} type="button">Add member</button> : null}
      </div>
    </header>
    {pendingJoining || directInvitations ? <nav className="mb-3 flex flex-wrap gap-1" aria-label="Member directory views">
      {([['members', 'Members'], ...(pendingJoining ? [['pending', 'Pending joining']] : []), ...(directInvitations ? [['direct', 'Ruined Direct']] : [])] as Array<['members' | 'pending' | 'direct', string]>).map(([key, label]) => <button type="button" key={key} aria-controls={key === "members" ? "member-directory-panel" : key === "pending" ? "pending-joining-panel" : "direct-invitations-panel"} aria-pressed={view === key} onClick={() => switchView(key)} className={`min-h-11 rounded-[4px] px-4 text-sm font-medium ${view === key ? 'bg-black/[0.08] text-black' : 'text-black/60 hover:bg-black/[0.04]'}`}>{label}</button>)}
    </nav> : null}
    {navigationNotice ? <p className="mb-4 text-sm" role="status">{navigationNotice}</p> : null}
    <div hidden={view !== "members"} id="member-directory-panel">{children}</div>
    {pendingJoining ? <div hidden={view !== "pending"} id="pending-joining-panel" ref={pendingPanel}>{pendingJoining}</div> : null}
    {directInvitations ? <div hidden={view !== "direct"} id="direct-invitations-panel">{directInvitations}</div> : null}
    {adding && pendingJoining ? <OperatorDialog open title="Add member" onClose={close} returnFocusId="add-member-trigger">
      <div id="allow-member-email"><OpsInvitationActions preview={preview} onSaved={() => router.refresh()} /></div>
    </OperatorDialog> : null}
  </div>;
}
