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
type Confirmation =
  | { kind: "remove"; circleId: string; memberId: string; assignmentId: string }
  | { kind: "move"; circleId: string; memberId: string; assignmentId: string; toCircleId: string }
  | { kind: "activate" | "delete" | "archive"; circleId: string }
  | null;

async function request<T>(path: string, method: "POST" | "PATCH" | "DELETE", body: Record<string, string>): Promise<T> {
  const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(typeof payload?.error === "string" ? payload.error : "The change could not be saved. Refresh the Circle and try again.");
  return payload as T;
}

export default function OperatorCirclesManager({
  initialCircles, initialAssignments, candidates, initialMemberId, initialCircleId,
  memberQuery = "", candidateTotal, candidatePage = 1, candidatePageCount = 1, pinnedMemberId, preview, children,
}: {
  initialCircles: OpsCircleSummary[];
  initialAssignments: OpsCircleMemberAssignment[];
  candidates: OperatorMemberSummary[];
  initialMemberId?: string;
  initialCircleId?: string;
  memberQuery?: string;
  candidateTotal: number;
  candidatePage?: number;
  candidatePageCount?: number;
  pinnedMemberId?: string;
  preview: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [circles, setCircles] = useState(initialCircles);
  const [assignments, setAssignments] = useState(initialAssignments);
  const memberCircle = initialAssignments.find((assignment) => assignment.memberId === initialMemberId)?.circleId;
  const [openCircleId, setOpenCircleId] = useState(initialCircles.some((circle) => circle.id === initialCircleId) ? initialCircleId : memberCircle);
  const [pending, setPending] = useState(false);
  const requestInFlight = useRef(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [notices, setNotices] = useState<Record<string, Notice>>({});
  const [circleName, setCircleName] = useState("");
  const [confirmationName, setConfirmationName] = useState("");
  const confirmationFieldRef = useRef<HTMLInputElement>(null);
  const destinationFieldRef = useRef<HTMLSelectElement>(null);
  const confirmationTarget = confirmation ? `${confirmation.kind}:${confirmation.circleId}:${"assignmentId" in confirmation ? confirmation.assignmentId : ""}` : null;

  useEffect(() => setCircles(initialCircles), [initialCircles]);
  useEffect(() => setAssignments(initialAssignments), [initialAssignments]);
  useEffect(() => {
    const field = confirmationFieldRef.current ?? destinationFieldRef.current;
    if (!field) return;
    const trigger = document.activeElement;
    field.focus();
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [confirmationTarget]);

  const initialMember = candidates.find((member) => member.memberId === initialMemberId);
  function placementIssue(member: OperatorMemberSummary) {
    const assignment = assignments.find((item) => item.memberId === member.memberId);
    if (assignment) return `Already in ${circles.find((item) => item.id === assignment.circleId)?.name ?? member.circleName ?? "a Circle"}.`;
    if (member.membershipState && member.membershipState !== "active") return `Membership is ${member.membershipState.replaceAll("_", " ")}. Review membership before adding this person.`;
    return getCirclePlacementIssue(member);
  }
  const eligibleMembers = candidates.filter((member) => !placementIssue(member));
  const available = (circle: OpsCircleSummary) => (circle.status === "forming" || circle.status === "active") && circle.activeMembers < circle.capacity;
  function transferIssue(member: OpsCircleMemberAssignment) {
    const saved = candidates.find((candidate) => candidate.memberId === member.memberId);
    if (saved?.membershipState && saved.membershipState !== "active") return "Review this person’s membership before moving them.";
    return member.accountState === "active" && member.billingState === "active" && (member.programState === "onboarding" || member.programState === "active")
      ? null : "An active account, active billing and an onboarding or active program are required to move Circles.";
  }

  function beginMove(member: OpsCircleMemberAssignment, panelCircleId: string, toCircleId = "") {
    setConfirmation({ kind: "move", circleId: panelCircleId, memberId: member.memberId, assignmentId: member.assignmentId, toCircleId });
  }
  function searchHref(circleId: string, page = 1, query = memberQuery) {
    const params = new URLSearchParams({ circleId });
    if (query) params.set("memberQuery", query);
    if (page > 1) params.set("memberPage", String(page));
    return `/ops/circles?${params.toString()}#member-search-${circleId}`;
  }

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

  async function addMember(event: FormEvent<HTMLFormElement>, circle: OpsCircleSummary, memberId: string) {
    event.preventDefault();
    const member = eligibleMembers.find((candidate) => candidate.memberId === memberId);
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
      return `${member.name} ${result.assignment.created ? "added to" : "is already in"} ${circle.name}.${circle.status === "forming" ? " Activate this Circle when it is ready." : ""} Connected Calendar changes are queued; check affected Experiences for their sync status.`;
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
    } else if (currentConfirmation.kind === "move") {
      const member = assignments.find((item) => item.assignmentId === currentConfirmation.assignmentId && item.memberId === currentConfirmation.memberId);
      const destination = circles.find((item) => item.id === currentConfirmation.toCircleId);
      const source = circles.find((item) => item.id === member?.circleId);
      if (!member || !source || !destination || source.id === destination.id || !available(destination) || transferIssue(member)) return;
      await change(circle.id, async () => {
        const result = await request<{ transfer: { id: string; previousAssignmentId: string; assignedAt: string; memberId: string; fromCircleId: string; circleId: string; fromCircleStatus: OpsCircleSummary["status"]; fromBlockId: string | null; fromBlockStatus: OpsCircleSummary["blockStatus"] } }>("/api/ops/circle-transfers", "POST", {
          memberId: member.memberId, fromCircleId: source.id, assignmentId: member.assignmentId, toCircleId: destination.id,
        });
        const moved = result.transfer;
        if (!moved || typeof moved.id !== "string" || !moved.id || moved.id === member.assignmentId
          || moved.previousAssignmentId !== member.assignmentId || moved.memberId !== member.memberId
          || moved.fromCircleId !== source.id || moved.circleId !== destination.id
          || !Number.isFinite(Date.parse(moved.assignedAt)) || !["active", "forming", "archived", "completed"].includes(moved.fromCircleStatus)) {
          throw new Error("The response could not be verified. Refresh both rosters to confirm the move before repeating it.");
        }
        setAssignments((current) => current.map((item) => item.assignmentId === member.assignmentId ? { ...item, assignmentId: moved.id, circleId: moved.circleId, assignedAt: moved.assignedAt } : item));
        setCircles((current) => current.map((item) => ({ ...item,
          ...(item.id === source.id ? { activeMembers: Math.max(0, item.activeMembers - 1), status: moved.fromCircleStatus } : {}),
          ...(item.id === destination.id ? { activeMembers: item.activeMembers + 1 } : {}),
          ...(moved.fromBlockId && item.blockId === moved.fromBlockId ? { blockStatus: moved.fromBlockStatus } : {}),
        })));
        return `${member.name} moved from ${source.name} to ${destination.name}. Their history is preserved.${moved.fromCircleStatus === "archived" ? " The empty source Circle is now archived." : ""}${moved.fromBlockStatus === "archived" ? " Its Block is also archived." : ""} Connected Calendar changes are queued; check affected Experiences for their sync status.`;
      });
    } else if (currentConfirmation.kind === "delete" || currentConfirmation.kind === "archive") {
      if (circle.activeMembers || confirmationName.trim() !== circle.name) return;
      const deleting = currentConfirmation.kind === "delete";
      await change("circle-removal", async () => {
        const result = await request<{ circle: { id: string; name: string; outcome: "deleted" | "archived"; blockId?: string | null; blockStatus?: OpsCircleSummary["blockStatus"] } }>(`/api/ops/circles/${encodeURIComponent(circle.id)}`, deleting ? "DELETE" : "PATCH", { confirmationName: confirmationName.trim(), ...(deleting ? {} : { action: "archive" }) });
        if (!result.circle || result.circle.id !== circle.id || result.circle.name !== circle.name || result.circle.outcome !== (deleting ? "deleted" : "archived")) throw new Error("The response could not be verified. Refresh the Circle list before repeating this action.");
        setCircles((current) => deleting ? current.filter((item) => item.id !== circle.id) : current.map((item) => ({ ...item,
          ...(item.id === circle.id ? { status: "archived" as const } : {}),
          ...(result.circle.blockId && item.blockId === result.circle.blockId && result.circle.blockStatus ? { blockStatus: result.circle.blockStatus } : {}),
        })));
        setConfirmationName("");
        return deleting ? `${circle.name} deleted. No member records were removed.` : `${circle.name} archived. Its history is preserved.${result.circle.blockStatus === "archived" ? " Its Block is also archived." : ""} Existing Experiences and invitations are unchanged; review any future meetings.`;
      });
    } else if (currentConfirmation.kind === "remove") {
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
        return `${member.name} removed from ${circle.name}. Their account and history are unchanged.${result.assignment.circleStatus === "archived" ? " The empty Circle is now archived." : ""}${result.assignment.blockStatus === "archived" ? " Its Block is also archived." : ""} Connected Calendar changes are queued; check affected Experiences for their sync status.`;
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
    if (confirmation.kind === "move") {
      if (!member || member.assignmentId !== confirmation.assignmentId) return null;
      const source = circles.find((item) => item.id === member.circleId);
      const destination = circles.find((item) => item.id === confirmation.toCircleId);
      const destinations = circles.filter((item) => item.id !== member.circleId && available(item));
      const issue = transferIssue(member);
      return <div className="mt-3 rounded-[4px] bg-[var(--color-shop)]/35 p-4" role="group" aria-label={`Move ${member.name} to another Circle`}>
        <p className="text-sm">Move <strong>{member.name}</strong> from <strong>{source?.name ?? "their Circle"}</strong>.</p>
        {issue ? <p className="mt-2 text-sm text-[var(--color-poster)]">{issue} <Link className="underline" href={`/ops/members/${encodeURIComponent(member.memberId)}#membership`}>Review membership</Link></p> : destinations.length ? <>
          <label className="mt-3 block"><span className={OPERATOR_LABEL_TEXT_CLASS}>Move to</span><select ref={destinationFieldRef} className={`${OPERATOR_FIELD_CLASS} mt-2`} aria-label={`New Circle for ${member.name}`} value={confirmation.toCircleId} disabled={pending} onChange={(event) => setConfirmation({ ...confirmation, toCircleId: event.target.value })}>
            <option value="">Choose a Circle</option>{destinations.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.capacity - item.activeMembers} places · {item.status}</option>)}
          </select></label>
          <p className="mt-3 text-xs leading-relaxed text-black/65">Their membership and history stay intact. The move only happens if the new Circle has room.{destination?.status === "forming" ? " This Circle must be activated before they can finish Foundations." : ""}{source?.status === "active" && source.activeMembers === 1 ? " Moving the last member archives the old Circle; its Block may also be archived if too few Circles remain." : ""}</p>
        </> : <p className="mt-3 text-sm">No other Circles have an open place. <a className="underline" href="#create-circle">Create a Circle</a> first.</p>}
        <div className="mt-3 flex flex-wrap gap-2"><button className={BUTTON} disabled={pending || !!issue || !destination || !available(destination) || destination.id === member.circleId} onClick={() => confirmChange(circle)} type="button">{pending ? "Moving…" : "Confirm move"}</button><button className={SECONDARY} disabled={pending} onClick={() => setConfirmation(null)} type="button">Cancel</button></div>
      </div>;
    }
    if (confirmation.kind === "delete" || confirmation.kind === "archive") {
      if (member) return null;
      const deleting = confirmation.kind === "delete";
      return <div className="mt-4 rounded-[4px] bg-[var(--color-poster)]/[0.06] p-4" role="group" aria-label={deleting ? "Confirm Circle deletion" : "Confirm Circle archive"}>
        <p className="text-sm leading-relaxed">{deleting ? <>Permanently delete <strong>{circle.name}</strong>? Only an unused Circle can be deleted. If it has a history, archive it instead. This cannot be undone.</> : <>Archive <strong>{circle.name}</strong>? It will stop accepting members and cannot be reopened. Its records and history stay intact. Existing events and invitations will not be cancelled.{circle.blockStatus === "active" ? " Its Block may also be archived if fewer than two Circles remain." : ""}</>}</p>
        <label className="mt-3 block"><span className={OPERATOR_LABEL_TEXT_CLASS}>Type {circle.name} to confirm</span><input ref={confirmationFieldRef} className={`${OPERATOR_FIELD_CLASS} mt-2`} aria-label="Circle name to confirm" value={confirmationName} onChange={(event) => setConfirmationName(event.target.value)} autoComplete="off" disabled={pending} /></label>
        <div className="mt-3 flex flex-wrap gap-2"><button className={`${BUTTON} bg-[var(--color-poster)]`} disabled={pending || circle.activeMembers > 0 || confirmationName.trim() !== circle.name} onClick={() => confirmChange(circle)} type="button">{pending ? "Saving…" : deleting ? "Permanently delete Circle" : "Confirm archive"}</button><button className={SECONDARY} disabled={pending} onClick={() => setConfirmation(null)} type="button">Cancel</button></div>
        {notice("circle-removal")}
      </div>;
    }
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
      {!confirmation || (confirmation.kind !== "delete" && confirmation.kind !== "archive") ? notice("circle-removal") : null}
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
                      <div className="flex shrink-0 flex-wrap justify-end gap-1">
                        <button type="button" className={SECONDARY} disabled={pending} aria-label={`Move ${member.name} from ${circle.name}`} onClick={() => beginMove(member, circle.id)}>Move</button>
                        <button type="button" className={`${SECONDARY} text-[var(--color-poster)]`} disabled={pending} aria-label={`Remove ${member.name} from ${circle.name}`} onClick={() => setConfirmation({ kind: "remove", circleId: circle.id, memberId: member.memberId, assignmentId: member.assignmentId })}>Remove</button>
                      </div>
                    </div>{confirmPanel(circle, member)}</li>)}</ul> : <p className="text-sm text-black/60">No members yet. Add the first person here.</p>}
                  </div>
                  <div id={`member-search-${circle.id}`} className="scroll-mt-28"><h3 className="mb-3"><span className={OPERATOR_LABEL_TEXT_CLASS}>Add a member</span></h3>
                    {available(circle) ? <>
                      <form action={`/ops/circles#member-search-${circle.id}`} method="get" className="mb-4 flex flex-wrap gap-2">
                        <input type="hidden" name="circleId" value={circle.id} />
                        <label className="min-w-0 flex-1"><span className="sr-only">Find a member for {circle.name}</span><input className={OPERATOR_FIELD_CLASS} defaultValue={memberQuery} name="memberQuery" placeholder="Search name or email" type="search" maxLength={120} disabled={pending} /></label>
                        <button className={SECONDARY} type="submit" disabled={pending}>Search</button>
                      </form>
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-black/60">
                        <p role="status">{memberQuery ? `${candidateTotal} ${candidateTotal === 1 ? "match" : "matches"} for “${memberQuery}”` : "Members ready for placement"}{pinnedMemberId ? " · Selected member also shown" : ""}</p>
                        {memberQuery ? <Link className="underline underline-offset-4" href={searchHref(circle.id, 1, "")}>Clear search</Link> : null}
                      </div>
                      <ul aria-label={`Member results for ${circle.name}`} className="grid gap-3">
                        {candidates.map((member) => {
                          const issue = placementIssue(member);
                          const assignment = assignments.find((item) => item.memberId === member.memberId);
                          return <li key={member.memberId} className="rounded-[4px] bg-white/30 p-3">
                            {member.memberId === pinnedMemberId ? <p className="mb-2 text-xs font-semibold text-black/60">Selected from member profile</p> : null}
                            <form aria-label={`Add ${member.name} to ${circle.name}`} data-member-id={member.memberId} onSubmit={(event) => addMember(event, circle, member.memberId)} className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0 flex-1"><Link className="text-sm font-semibold underline decoration-black/20 underline-offset-4" href={`/ops/members/${encodeURIComponent(member.memberId)}`}>{member.name}</Link><p className="break-all text-xs text-black/55">{member.email}</p></div>
                              {assignment && assignment.circleId !== circle.id ? <button className={`${BUTTON} shrink-0`} type="button" disabled={pending} aria-label={`Move ${member.name} to ${circle.name}`} onClick={() => beginMove(assignment, circle.id, circle.id)}>Move here</button> : <button className={`${BUTTON} shrink-0`} type="submit" disabled={pending || !!issue} aria-label={`Add ${member.name} to ${circle.name}`}>{pending ? "Saving…" : assignment?.circleId === circle.id ? "In this Circle" : "Add to Circle"}</button>}
                            </form>
                            {issue ? <div className="mt-2 text-xs leading-relaxed text-black/60"><p>{issue}</p>{assignment ? assignment.circleId !== circle.id ? <Link className="mt-1 inline-flex min-h-9 items-center underline underline-offset-4" href={searchHref(assignment.circleId)}>Open their Circle →</Link> : null : <Link className="mt-1 inline-flex min-h-9 items-center font-semibold underline underline-offset-4" href={`/ops/members/${encodeURIComponent(member.memberId)}#membership`}>Review membership →</Link>}</div> : null}
                            {assignment && assignment.circleId !== circle.id ? confirmPanel(circle, assignment) : null}
                          </li>;
                        })}
                      </ul>
                      {!candidates.length ? <p className="py-2 text-sm leading-relaxed text-black/60">{memberQuery ? "No members match this search. Try their name or email, or check the member directory." : "No members are ready to add here. Search by name to check someone’s status, or allow a new member email."} <Link className="inline-flex min-h-9 items-center font-semibold underline underline-offset-4" href="/ops/members">Go to Members →</Link></p> : null}
                      {candidatePageCount > 1 ? <nav aria-label={`Member result pages for ${circle.name}`} className="mt-4 flex items-center justify-between gap-3 text-sm"><span>Page {candidatePage} of {candidatePageCount}</span><div className="flex gap-3">{candidatePage > 1 ? <Link className={SECONDARY} href={searchHref(circle.id, candidatePage - 1)}>Previous members</Link> : null}{candidatePage < candidatePageCount ? <Link className={SECONDARY} href={searchHref(circle.id, candidatePage + 1)}>Next members</Link> : null}</div></nav> : candidateTotal > candidates.length ? <p className="mt-3 text-xs text-black/60">Search by name or email to find people beyond these first results.</p> : null}
                    </> : <p className="text-sm text-black/60">{circle.activeMembers >= circle.capacity ? "This Circle is full. Remove a member only if their placement should end, or create another Circle below." : "This Circle is closed to new members."}</p>}
                  </div>
                </div>
                {circle.status === "forming" ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-sm text-black/60">{circle.activeMembers ? "Activate when the Shaper, members, and first meeting are ready. Members need an active Circle to finish Foundations." : "Add the first member before activating this Circle."}</p><button className={SECONDARY} type="button" disabled={pending || !circle.activeMembers} onClick={() => setConfirmation({ kind: "activate", circleId: circle.id })}>Activate {circle.name}</button></div> : null}
                {confirmation?.kind === "activate" ? confirmPanel(circle) : null}
                {notice(circle.id)}
              </section>
              <div className="px-5 pb-4 sm:px-6">
                <div className="flex flex-wrap items-center gap-x-3">
                  {circle.status !== "archived" ? <button className={SECONDARY} type="button" disabled={pending || circle.activeMembers > 0} aria-label={`Archive ${circle.name}`} onClick={() => { setConfirmationName(""); setNotices((current) => ({ ...current, "circle-removal": null })); setConfirmation({ kind: "archive", circleId: circle.id }); }}>Archive Circle</button> : null}
                  {circle.status === "forming" ? <button className={`${SECONDARY} text-[var(--color-poster)]`} type="button" disabled={pending || circle.activeMembers > 0} aria-label={`Delete ${circle.name}`} onClick={() => { setConfirmationName(""); setNotices((current) => ({ ...current, "circle-removal": null })); setConfirmation({ kind: "delete", circleId: circle.id }); }}>Delete Circle</button> : null}
                  <p className="text-xs text-black/55">{circle.status === "archived" ? "Archived. History retained." : circle.activeMembers > 0 ? "Move members out before archiving or deleting." : circle.status === "forming" ? "Archive keeps history. Delete is for unused Circles only." : "Archive this Circle to keep its history."}</p>
                </div>
                {confirmation?.kind === "delete" || confirmation?.kind === "archive" ? confirmPanel(circle) : null}
              </div>
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
