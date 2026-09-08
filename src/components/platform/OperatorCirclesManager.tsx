"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { getCirclePlacementIssue } from "@/components/platform/OpsActions";
import { OPERATOR_FIELD_CLASS, OPERATOR_LABEL_TEXT_CLASS } from "@/components/platform/operatorStyles";
import StateLabel from "@/components/platform/StateLabel";
import type { OperatorMemberSummary } from "@/lib/platform/model";
import type { OpsCircleMemberAssignment, OpsCircleSummary } from "@/lib/platform/ops-repository";

const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-[4px] bg-[var(--color-faded)] px-4 py-2 text-sm font-semibold text-[var(--color-bone)] hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)] disabled:cursor-not-allowed disabled:opacity-40";
const SECONDARY = "inline-flex min-h-11 items-center justify-center rounded-[4px] px-3 py-2 text-sm font-medium underline decoration-black/25 underline-offset-4 hover:text-[var(--color-poster)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40";
type Notice = { error: boolean; text: string } | null;
type Confirmation = { kind: "remove"; circleId: string; memberId: string; assignmentId: string } | { kind: "activate"; circleId: string } | null;

async function request<T>(path: string, method: "POST" | "PATCH", body: Record<string, string>): Promise<T> {
  const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(typeof payload?.error === "string" ? payload.error : "The change could not be saved. Refresh the Circle and try again.");
  return payload as T;
}

export default function OperatorCirclesManager({
  initialCircles, initialAssignments, candidates, initialMemberId, initialCircleId,
  memberQuery = "", candidateTotal, preview, children,
}: {
  initialCircles: OpsCircleSummary[];
  initialAssignments: OpsCircleMemberAssignment[];
  candidates: OperatorMemberSummary[];
  initialMemberId?: string;
  initialCircleId?: string;
  memberQuery?: string;
  candidateTotal: number;
  preview: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [circles, setCircles] = useState(initialCircles);
  const [assignments, setAssignments] = useState(initialAssignments);
  const memberCircle = initialAssignments.find((assignment) => assignment.memberId === initialMemberId)?.circleId;
  const [openCircleId, setOpenCircleId] = useState(initialCircles.some((circle) => circle.id === initialCircleId) ? initialCircleId : memberCircle);
  const [selectedMemberId, setSelectedMemberId] = useState(initialMemberId ?? "");
  const [pending, setPending] = useState(false);
  const requestInFlight = useRef(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const [circleName, setCircleName] = useState("");

  useEffect(() => setCircles(initialCircles), [initialCircles]);
  useEffect(() => setAssignments(initialAssignments), [initialAssignments]);

  const selectedMember = candidates.find((member) => member.memberId === selectedMemberId);
  const initialMember = candidates.find((member) => member.memberId === initialMemberId);
  const eligibleMembers = candidates.filter((member) => !getCirclePlacementIssue(member) && !assignments.some((assignment) => assignment.memberId === member.memberId));
  const selectedIssue = selectedMember ? getCirclePlacementIssue(selectedMember) : null;
  const blockedMatches = candidates.filter((member) => member.memberId !== selectedMemberId && !member.circleName && getCirclePlacementIssue(member)).slice(0, 3);
  const available = (circle: OpsCircleSummary) => (circle.status === "forming" || circle.status === "active") && circle.activeMembers < circle.capacity;

  function notice(key: string) {
    const item = notices[key];
    return item ? <p className={`mt-3 text-sm leading-relaxed ${item.error ? "text-[var(--color-poster)]" : "text-[var(--color-verdigris)]"}`} role={item.error ? "alert" : "status"}>{item.text}</p> : null;
  }
  async function change(key: string, work: () => Promise<string>) {
    if (requestInFlight.current) return;
    if (preview) {
      setNotices((current) => ({ ...current, [key]: { error: false, text: "Preview only. No Circle or member record was changed." } }));
      setConfirmation(null);
      return;
    }
    requestInFlight.current = true;
    setPending(true);
    setNotices((current) => ({ ...current, [key]: null }));
    try {
      const text = await work();
      setNotices((current) => ({ ...current, [key]: { error: false, text } }));
      setConfirmation(null);
      router.refresh();
    } catch (error) {
      setNotices((current) => ({ ...current, [key]: { error: true, text: error instanceof Error ? error.message : "The change could not be saved." } }));
    } finally {
      requestInFlight.current = false;
      setPending(false);
    }
  }

  async function addMember(event: FormEvent<HTMLFormElement>, circle: OpsCircleSummary) {
    event.preventDefault();
    const member = eligibleMembers.find((candidate) => candidate.memberId === selectedMemberId);
    if (!member || !available(circle)) return;
    await change(circle.id, async () => {
      const result = await request<{ assignment: { created: boolean; id: string; assignedAt: string; memberId: string; circleId: string } }>("/api/ops/circle-assignments", "POST", { memberId: member.memberId, circleId: circle.id });
      if (!result.assignment || typeof result.assignment.id !== "string" || !result.assignment.id
        || typeof result.assignment.created !== "boolean" || !Number.isFinite(Date.parse(result.assignment.assignedAt))
        || result.assignment.memberId !== member.memberId || result.assignment.circleId !== circle.id) {
        throw new Error("The response could not be verified. Refresh the Circle to confirm whether the member was added before repeating this action.");
      }
      setAssignments((current) => current.some((assignment) => assignment.memberId === member.memberId) ? current : [...current, {
        memberId: member.memberId, circleId: circle.id, name: member.name, email: member.email,
        assignmentId: result.assignment.id, assignedAt: result.assignment.assignedAt,
        accountState: member.accountState, billingState: member.billingState, programState: member.programState,
      }]);
      if (result.assignment.created) setCircles((current) => current.map((item) => item.id === circle.id ? { ...item, activeMembers: item.activeMembers + 1 } : item));
      setSelectedMemberId("");
      return `${member.name} ${result.assignment.created ? "added to" : "is already in"} ${circle.name}.${circle.status === "forming" ? " Activate this Circle when it is ready." : ""} Review affected Experiences and sync their invitations.`;
    });
  }

  async function confirmChange(circle: OpsCircleSummary) {
    if (!confirmation || confirmation.circleId !== circle.id) return;
    const currentConfirmation = confirmation;
    if (currentConfirmation.kind === "activate") {
      if (circle.status !== "forming" || circle.activeMembers === 0) return;
      await change(circle.id, async () => {
        const result = await request<{ circle: OpsCircleSummary }>("/api/ops/circles", "PATCH", { circleId: circle.id });
        if (!result.circle || result.circle.id !== circle.id || result.circle.status !== "active" || !Number.isInteger(result.circle.activeMembers) || result.circle.activeMembers < 1) throw new Error("The response could not be verified. Refresh to confirm the Circle status before repeating this action.");
        setCircles((current) => current.map((item) => item.id === circle.id ? { ...item, status: result.circle.status, activeMembers: result.circle.activeMembers } : item));
        return `${circle.name} is active. Its members can now complete Foundations once their other requirements are met.`;
      });
    } else {
      const member = assignments.find((assignment) => assignment.assignmentId === currentConfirmation.assignmentId && assignment.memberId === currentConfirmation.memberId && assignment.circleId === circle.id);
      if (!member) { setConfirmation(null); return; }
      await change(circle.id, async () => {
        const result = await request<{ assignment: { circleId: string; circleStatus: OpsCircleSummary["status"]; blockId: string | null; blockStatus: OpsCircleSummary["blockStatus"] } }>("/api/ops/circle-assignments", "PATCH", { memberId: member.memberId, circleId: circle.id });
        if (!result.assignment || result.assignment.circleId !== circle.id || !["active", "forming", "archived", "completed"].includes(result.assignment.circleStatus)) throw new Error("The response could not be verified. Refresh the roster before making another change.");
        setAssignments((current) => current.filter((assignment) => assignment.assignmentId !== member.assignmentId));
        setCircles((current) => current.map((item) => ({ ...item,
          ...(item.id === circle.id ? { activeMembers: Math.max(0, item.activeMembers - 1), status: result.assignment.circleStatus } : {}),
          ...(result.assignment.blockId && item.blockId === result.assignment.blockId ? { blockStatus: result.assignment.blockStatus } : {}),
        })));
        return `${member.name} removed from ${circle.name}. Their account and history are unchanged.${result.assignment.circleStatus === "archived" ? " The empty Circle is now archived." : ""}${result.assignment.blockStatus === "archived" ? " Its Block is also archived." : ""} Review affected Experiences and sync their invitations.`;
      });
    }
  }

  async function createCircle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = circleName.trim();
    if (name.length < 2) return;
    await change("create", async () => {
      const result = await request<{ circle: OpsCircleSummary }>("/api/ops/circles", "POST", { name });
      if (!result.circle || typeof result.circle.id !== "string" || !result.circle.id || typeof result.circle.name !== "string"
        || result.circle.status !== "forming" || !Number.isInteger(result.circle.capacity) || result.circle.capacity < 1
        || result.circle.activeMembers !== 0) throw new Error("The response could not be verified. Refresh to confirm whether the Circle was created before repeating this action.");
      setCircles((current) => [...current, { ...result.circle, resources: result.circle.resources ?? [], shaper: result.circle.shaper ?? null }]);
      setOpenCircleId(result.circle.id);
      setCircleName("");
      return `${result.circle.name} created. Use Manage members above to add its first member.`;
    });
  }

  function confirmPanel(circle: OpsCircleSummary, member?: OpsCircleMemberAssignment) {
    if (!confirmation || confirmation.circleId !== circle.id) return null;
    if (confirmation.kind === "remove" && (!member || member.assignmentId !== confirmation.assignmentId)) return null;
    if (confirmation.kind === "activate" && member) return null;
    return <div className="mt-3 rounded-[4px] bg-[var(--color-highlight)]/30 p-4" role="group" aria-label={confirmation.kind === "remove" ? "Confirm member removal" : "Confirm Circle activation"}>
      <p className="text-sm leading-relaxed">{confirmation.kind === "remove" ? <>Remove <strong>{member?.name}</strong> from <strong>{circle.name}</strong>? Their account and history stay intact.{circle.status === "active" && circle.activeMembers === 1 ? " This is the last member: the Circle will be archived, and its Block may also be archived if too few Circles remain." : ""}</> : <>Activate <strong>{circle.name}</strong> for all its members?</>}</p>
      <div className="mt-3 flex flex-wrap gap-2"><button className={BUTTON} disabled={pending} onClick={() => confirmChange(circle)} type="button">{pending ? "Saving…" : confirmation.kind === "remove" ? "Confirm removal" : "Confirm activation"}</button><button className={SECONDARY} disabled={pending} onClick={() => setConfirmation(null)} type="button">Cancel</button></div>
    </div>;
  }

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-black/60">{circles.length} {circles.length === 1 ? "Circle" : "Circles"} · choose one to manage its members</p>
        <nav aria-label="Circle setup" className="flex gap-4"><a className={SECONDARY} href="#create-circle">+ Create a Circle</a><a className={SECONDARY} href="#circle-resources">Shapers & resources</a></nav>
      </div>
      <section id="assign-member" className="scroll-mt-28" aria-label="Circles and members">
        {initialMemberId ? <p className="mb-4 rounded-[4px] bg-[var(--color-shop)]/35 p-4 text-sm leading-relaxed">
          {initialMember ? <>For <strong>{initialMember.name}</strong>, choose a Circle and select Manage members.{getCirclePlacementIssue(initialMember) ? ` ${getCirclePlacementIssue(initialMember)}` : ""} <Link className="underline underline-offset-4" href={`/ops/members/${encodeURIComponent(initialMember.memberId)}`}>Back to member</Link></> : memberCircle ? "This member’s Circle is open below." : "The selected member is unavailable. Search for a member inside a Circle, or review their member record."}
        </p> : null}
        <span id="activate-circle" className="block scroll-mt-28" />
        <div className="grid gap-4">
          {circles.length === 0 ? <p className="py-8 text-black/60">No Circles yet. Create the first one below, then add its members.</p> : circles.map((circle) => {
            const roster = assignments.filter((assignment) => assignment.circleId === circle.id);
            const open = openCircleId === circle.id;
            return <article id={`circle-${circle.id}`} key={circle.id} className="scroll-mt-28 overflow-hidden rounded-[5px] bg-black/[0.035]">
              <header className="flex flex-wrap items-center justify-between gap-5 p-5 sm:p-6">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-4"><h2 className="font-[var(--font-display)] text-3xl leading-none">{circle.name}</h2><StateLabel state={circle.status} /></div>
                  <p className="mt-3 text-sm text-black/60">{circle.activeMembers}/{circle.capacity} members · {Math.max(0, circle.capacity - circle.activeMembers)} open places</p>
                  <p className="mt-1 text-sm text-black/60">Shaper: {circle.shaper?.name ?? "Not assigned"}{circle.blockName ? ` · ${circle.blockName}` : ""}</p>
                </div>
                <button className={`${BUTTON} ${open ? "bg-[var(--color-verdigris)]" : ""}`} aria-expanded={open} aria-controls={`roster-${circle.id}`} aria-label={`Manage members — ${circle.name}`} disabled={pending} onClick={() => { setOpenCircleId(open ? undefined : circle.id); setConfirmation(null); }} type="button">{open ? "Close members" : "Manage members"}<span aria-hidden="true" className="ml-3">{open ? "−" : "+"}</span></button>
              </header>
              <section id={`roster-${circle.id}`} aria-label={`${circle.name} members`} hidden={!open} className="px-5 pb-5 sm:px-6 sm:pb-6">
                <div className="grid gap-6 rounded-[4px] bg-[var(--color-bone)]/60 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
                  <div><h3 className="mb-3"><span className={OPERATOR_LABEL_TEXT_CLASS}>Members</span></h3>
                    {roster.length ? <ul className="grid gap-2">{roster.map((member) => <li key={member.assignmentId} className="rounded-[4px] bg-black/[0.025] px-3 py-2"><div className="flex items-center justify-between gap-3">
                      <div className="min-w-0"><Link className="text-sm font-semibold underline decoration-black/20 underline-offset-4" href={`/ops/members/${encodeURIComponent(member.memberId)}`}>{member.name}</Link><p className="break-all text-xs text-black/55">{member.email}</p></div>
                      <button type="button" className={`${SECONDARY} shrink-0 text-[var(--color-poster)]`} disabled={pending} aria-label={`Remove ${member.name} from ${circle.name}`} onClick={() => setConfirmation({ kind: "remove", circleId: circle.id, memberId: member.memberId, assignmentId: member.assignmentId })}>Remove</button>
                    </div>{confirmPanel(circle, member)}</li>)}</ul> : <p className="text-sm text-black/60">No members yet. Add the first person here.</p>}
                  </div>
                  <div><h3 className="mb-3"><span className={OPERATOR_LABEL_TEXT_CLASS}>Add a member</span></h3>
                    {available(circle) ? <>
                      <form action="/ops/circles#assign-member" method="get" className="mb-4 flex flex-wrap gap-2">
                        <input type="hidden" name="circleId" value={circle.id} />
                        <label className="min-w-0 flex-1"><span className="sr-only">Find a member for {circle.name}</span><input className={OPERATOR_FIELD_CLASS} defaultValue={memberQuery} name="memberQuery" placeholder="Search name or email" type="search" maxLength={120} disabled={pending} /></label>
                        <button className={SECONDARY} type="submit" disabled={pending}>Search</button>
                      </form>
                      <form onSubmit={(event) => addMember(event, circle)} className="grid gap-3">
                        <label><span className="sr-only">Member to add to {circle.name}</span><select className={OPERATOR_FIELD_CLASS} value={selectedMember?.memberId ?? ""} onChange={(event) => setSelectedMemberId(event.target.value)} disabled={pending || !eligibleMembers.length} required aria-describedby={`member-help-${circle.id}`}>
                          <option value="" disabled>Choose member</option>
                          {selectedMember && !eligibleMembers.some((member) => member.memberId === selectedMember.memberId) ? <option value={selectedMember.memberId} disabled>{selectedMember.name} · not available</option> : null}
                          {eligibleMembers.map((member) => <option key={member.memberId} value={member.memberId}>{member.name} · {member.email}</option>)}
                        </select></label>
                        <p id={`member-help-${circle.id}`} className="text-xs leading-relaxed text-black/60">{selectedIssue ?? (!eligibleMembers.length ? "No eligible members in these results. Search for another person or review their membership." : candidateTotal > candidates.length ? "Search by name or email to find people beyond these first results." : "Only unassigned members with an active account, active billing, and an onboarding or active program can be added.")}</p>
                        {selectedMember && selectedIssue ? <Link className="text-sm underline underline-offset-4" href={`/ops/members/${encodeURIComponent(selectedMember.memberId)}#membership`}>Review {selectedMember.name}’s membership →</Link> : null}
                        <button className={`${BUTTON} w-fit`} type="submit" disabled={pending || !eligibleMembers.some((member) => member.memberId === selectedMemberId)}>Add to {circle.name}</button>
                      </form>
                      {(memberQuery || !eligibleMembers.length) && blockedMatches.length ? <ul aria-label="Members needing attention before placement" className="mt-4 grid gap-3">{blockedMatches.map((member) => <li className="text-xs leading-relaxed text-black/60" key={member.memberId}><Link className="text-sm font-semibold underline underline-offset-4" href={`/ops/members/${encodeURIComponent(member.memberId)}#membership`}>{member.name} — review membership</Link><p className="mt-1">{getCirclePlacementIssue(member)}</p></li>)}</ul> : null}
                    </> : <p className="text-sm text-black/60">{circle.activeMembers >= circle.capacity ? "This Circle is full. Remove a member only if their placement should end, or create another Circle below." : "This Circle is closed to new members."}</p>}
                  </div>
                </div>
                {circle.status === "forming" ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-sm text-black/60">{circle.activeMembers ? "Activate when the Shaper, members, and first meeting are ready. Members need an active Circle to finish Foundations." : "Add the first member before activating this Circle."}</p><button className={SECONDARY} type="button" disabled={pending || !circle.activeMembers} onClick={() => setConfirmation({ kind: "activate", circleId: circle.id })}>Activate {circle.name}</button></div> : null}
                {confirmPanel(circle)}
                {notice(circle.id)}
              </section>
            </article>;
          })}
        </div>
      </section>
      <section id="create-circle" aria-labelledby="create-circle-heading" className="scroll-mt-28 rounded-[4px] bg-[var(--color-shop)]/35 p-5 sm:p-6">
        <h2 id="create-circle-heading" className="font-[var(--font-display)] text-3xl">Create a Circle</h2>
        <p className="mt-2 text-sm text-black/60">Ten places. Starts forming, ready for you to add members.</p>
        <form onSubmit={createCircle} className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-0 flex-1"><span className={OPERATOR_LABEL_TEXT_CLASS}>Circle name</span><input className={`${OPERATOR_FIELD_CLASS} mt-2`} name="name" minLength={2} maxLength={80} required placeholder="Circle 02" value={circleName} onChange={(event) => setCircleName(event.target.value)} disabled={pending} /></label><button className={BUTTON} disabled={pending} type="submit">Create Circle</button></form>
        {notice("create")}
      </section>
      <section id="circle-resources" aria-label="Shapers and resources" className="scroll-mt-28">{children}</section>
    </div>
  );
}
