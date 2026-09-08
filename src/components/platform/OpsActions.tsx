"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  OPERATOR_BUTTON_CLASS,
  OPERATOR_FIELD_CLASS,
  OPERATOR_LABEL_CLASS,
  OPERATOR_LABEL_TEXT_CLASS,
} from "@/components/platform/operatorStyles";
import type { OperatorMemberSummary } from "@/lib/platform/model";

export type OpsActionCircle = {
  activeMembers: number;
  blockId: string | null;
  blockName: string | null;
  blockStatus: "active" | "archived" | "completed" | "forming" | null;
  capacity: number;
  id: string;
  name: string;
  slug: string;
  status: "active" | "archived" | "completed" | "forming";
};

export type OpsActionBlock = {
  circles: Array<{
    id: string;
    name: string;
    status: OpsActionCircle["status"];
  }>;
  currentCircles: number;
  id: string;
  name: string;
  slug: string;
  status: "active" | "archived" | "completed" | "forming";
};

type ActionNotice = {
  kind: "error" | "success";
  text: string;
} | null;

async function postJson<T>(
  path: string,
  body: Record<string, string>,
  method: "DELETE" | "PATCH" | "POST" = "POST",
): Promise<T> {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
  const payload = (await response.json().catch(() => null)) as
    | ({ error?: unknown } & T)
    | null;

  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : "The action could not be completed.";
    throw new Error(message);
  }
  if (!payload) throw new Error("The action did not return a result.");
  return payload;
}

function Notice({ notice }: { notice: ActionNotice }) {
  return (
    <p
      aria-live="polite"
      className={`min-h-5 text-xs leading-relaxed ${
        notice?.kind === "error" ? "text-[var(--color-poster)]" : "text-black/48"
      }`}
      role={notice?.kind === "error" ? "alert" : "status"}
    >
      {notice?.text ?? " "}
    </p>
  );
}

const INPUT_CLASS = OPERATOR_FIELD_CLASS;
const BUTTON_CLASS = OPERATOR_BUTTON_CLASS;
const SECONDARY_BUTTON_CLASS =
  "min-h-12 rounded-[4px] border border-black/35 bg-transparent px-5 font-[var(--font-body)] text-[0.62rem] font-medium uppercase tracking-[0.15em] text-black/65 hover:border-black hover:text-black disabled:cursor-not-allowed disabled:border-black/15 disabled:text-black/25";

export function OpsInvitationActions() {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<ActionNotice>(null);

  async function submitInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const intent = submitter instanceof HTMLButtonElement ? submitter.value : "record";

    try {
      if (intent === "revoke") {
        const result = await postJson<{
          revocation: { email: string; revoked: number };
        }>("/api/ops/invitations", { email }, "DELETE");
        setNotice({
          kind: "success",
          text: `${result.revocation.revoked} live invitation${result.revocation.revoked === 1 ? "" : "s"} revoked for ${result.revocation.email}.`,
        });
        formRef.current?.reset();
        return;
      }

      const result = await postJson<{
        invitation: { email: string; expiresAt: string; reissued: boolean };
      }>("/api/ops/invitations", { email });
      const expiration = new Intl.DateTimeFormat("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(new Date(result.invitation.expiresAt));
      setNotice({
        kind: "success",
          text: `${result.invitation.reissued ? "Access renewed" : "Access allowed"} for ${result.invitation.email} through ${expiration}. No email was sent.`,
      });
      formRef.current?.reset();
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The invitation could not be recorded.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="invite-member-heading">
      <h2 className="sr-only" id="invite-member-heading">Allow a member to join</h2>
      <form className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end" onSubmit={submitInvitation} ref={formRef}>
          <p className="text-sm leading-relaxed text-black/52 sm:col-span-3">
            This does not send an email. It allows this address to request a secure sign-in code and begin joining.
          </p>
          <label className={`${OPERATOR_LABEL_CLASS} sm:col-span-3`} htmlFor="ops-invitation-email">
            <span className={OPERATOR_LABEL_TEXT_CLASS}>Email</span>
            <input
              autoComplete="email"
              className={INPUT_CLASS}
              disabled={pending}
              id="ops-invitation-email"
              maxLength={254}
              name="email"
              placeholder="member@email.com"
              required
              type="email"
            />
          </label>
          <button className={BUTTON_CLASS} disabled={pending} name="intent" type="submit" value="record">
            {pending ? "Saving" : "Allow email"}
          </button>
          <button aria-label="Revoke live invite" className={SECONDARY_BUTTON_CLASS} disabled={pending} name="intent" type="submit" value="revoke">
            Remove allowance
          </button>
          <div className="sm:col-span-3"><Notice notice={notice} /></div>
      </form>
    </section>
  );
}

export function getCirclePlacementIssue(member: OperatorMemberSummary): string | null {
  if (member.circleName) return `Already assigned to ${member.circleName}. End that assignment before choosing another Circle.`;
  const missing: string[] = [];
  if (member.accountState !== "active") missing.push(`an active account (currently ${member.accountState})`);
  if (member.billingState !== "active") missing.push(`active billing (currently ${member.billingState.replaceAll("_", " ")})`);
  if (member.programState !== "onboarding" && member.programState !== "active") {
    missing.push(`an onboarding or active program (currently ${member.programState})`);
  }
  return missing.length ? `Before placement, this member needs ${missing.join(" and ")}. Review their membership record first.` : null;
}

export function OpsCircleActions({
  initialCircles,
  initialMemberId,
  members,
}: {
  initialCircles: OpsActionCircle[];
  initialMemberId?: string;
  members: OperatorMemberSummary[];
}) {
  const router = useRouter();
  const createFormRef = useRef<HTMLFormElement>(null);
  const assignmentFormRef = useRef<HTMLFormElement>(null);
  const activationFormRef = useRef<HTMLFormElement>(null);
  const endAssignmentFormRef = useRef<HTMLFormElement>(null);
  const [circles, setCircles] = useState(initialCircles);
  const [assignedMemberIds, setAssignedMemberIds] = useState<Set<string>>(() => new Set());
  const [endedMemberIds, setEndedMemberIds] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [activating, setActivating] = useState(false);
  const [endingAssignment, setEndingAssignment] = useState(false);
  const [createNotice, setCreateNotice] = useState<ActionNotice>(null);
  const [assignmentNotice, setAssignmentNotice] = useState<ActionNotice>(null);
  const [activationNotice, setActivationNotice] = useState<ActionNotice>(null);
  const [endAssignmentNotice, setEndAssignmentNotice] = useState<ActionNotice>(null);
  const [selectedMemberId, setSelectedMemberId] = useState(initialMemberId ?? "");
  const [selectedCircleId, setSelectedCircleId] = useState("");
  const [activationCircleId, setActivationCircleId] = useState("");
  const [createOpen, setCreateOpen] = useState(initialCircles.length === 0);

  useEffect(() => setCircles(initialCircles), [initialCircles]);
  useEffect(() => setSelectedMemberId(initialMemberId ?? ""), [initialMemberId]);

  function placementIssue(member: OperatorMemberSummary) {
    if (assignedMemberIds.has(member.memberId)) return "This member has just been assigned. Refresh the membership record before making another change.";
    return getCirclePlacementIssue(endedMemberIds.has(member.memberId) ? { ...member, circleName: null } : member);
  }
  const eligibleMembers = members.filter((member) => !placementIssue(member));
  // Query-string IDs only select records already supplied by the authorized page.
  const selectedMember = members.find((member) => member.memberId === selectedMemberId);
  const selectedMemberIssue = selectedMember
    ? placementIssue(selectedMember)
    : selectedMemberId ? "This member is not in the member list available to you. Choose a member below or ask an Administrator to check their account." : null;
  const acceptingCircles = circles.filter(
    (circle) =>
      (circle.status === "forming" || circle.status === "active") &&
      circle.activeMembers < circle.capacity,
  );
  const activatableCircles = circles.filter(
    (circle) => circle.status === "forming" && circle.activeMembers > 0,
  );
  const selectedMemberCircles = selectedMember && selectedMember.memberId === initialMemberId && selectedMember.circleName
    ? activatableCircles.filter((circle) => circle.name === selectedMember.circleName)
    : [];
  const selectedActivationCircleId = activationCircleId || (selectedMemberCircles.length === 1 ? selectedMemberCircles[0].id : "");
  const assignedMembers = members.filter(
    (member) => Boolean(member.circleName) && !endedMemberIds.has(member.memberId),
  );
  const selectedCircle = acceptingCircles.find((circle) => circle.id === selectedCircleId);

  async function submitCircle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreateNotice(null);

    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");

    try {
      const result = await postJson<{ circle: OpsActionCircle }>("/api/ops/circles", { name });
      setCircles((current) => [...current, result.circle]);
      setSelectedCircleId(result.circle.id);
      setCreateNotice({ kind: "success", text: `${result.circle.name} created with ${result.circle.capacity} spaces. Choose a member above to make the first assignment.` });
      createFormRef.current?.reset();
      router.refresh();
    } catch (error) {
      setCreateNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The Circle could not be created.",
      });
    } finally {
      setCreating(false);
    }
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAssigning(true);
    setAssignmentNotice(null);

    const form = new FormData(event.currentTarget);
    const memberId = String(form.get("memberId") ?? "");
    const circleId = String(form.get("circleId") ?? "");
    const member = eligibleMembers.find((candidate) => candidate.memberId === memberId);
    const circle = acceptingCircles.find((candidate) => candidate.id === circleId);

    try {
      if (!member || !circle) throw new Error("Choose an eligible member and a forming or active Circle with an open space.");
      const result = await postJson<{ assignment: { created: boolean } }>("/api/ops/circle-assignments", {
        circleId,
        memberId,
      });
      setAssignedMemberIds((current) => new Set(current).add(memberId));
      setEndedMemberIds((current) => {
        const next = new Set(current);
        next.delete(memberId);
        return next;
      });
      if (result.assignment.created) {
        setCircles((current) =>
          current.map((candidate) =>
            candidate.id === circleId
              ? { ...candidate, activeMembers: candidate.activeMembers + 1 }
              : candidate,
          ),
        );
      }
      setAssignmentNotice({
        kind: "success",
        text: result.assignment.created
          ? `${member.name} assigned to ${circle.name}.${circle.status === "forming" ? " Next: activate the Circle when it is ready. This lets its members complete Foundations." : " The Circle is already active."}`
          : `${member?.name ?? "Member"} is already assigned to ${circle?.name ?? "Circle"}.`,
      });
      setSelectedMemberId("");
      setSelectedCircleId("");
      if (circle.status === "forming") {
        setActivationCircleId(circle.id);
      }
      router.refresh();
    } catch (error) {
      setAssignmentNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The member could not be assigned.",
      });
    } finally {
      setAssigning(false);
    }
  }

  async function submitActivation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActivating(true);
    setActivationNotice(null);

    const form = new FormData(event.currentTarget);
    const circleId = String(form.get("circleId") ?? "");
    const circle = circles.find((candidate) => candidate.id === circleId);

    try {
      const result = await postJson<{
        circle: OpsActionCircle & { activated: boolean };
      }>("/api/ops/circles", { circleId }, "PATCH");
      setCircles((current) =>
        current.map((candidate) =>
          candidate.id === circleId ? { ...candidate, status: "active" } : candidate,
        ),
      );
      setActivationNotice({
        kind: "success",
        text: result.circle.activated
          ? `${circle?.name ?? "Circle"} is active. Assigned members can now complete Foundations.`
          : `${circle?.name ?? "Circle"} is already active.`,
      });
      activationFormRef.current?.reset();
      setActivationCircleId("");
      router.refresh();
    } catch (error) {
      setActivationNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The Circle could not be activated.",
      });
    } finally {
      setActivating(false);
    }
  }

  async function submitEndAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEndingAssignment(true);
    setEndAssignmentNotice(null);

    const form = new FormData(event.currentTarget);
    const memberId = String(form.get("memberId") ?? "");
    const member = assignedMembers.find((candidate) => candidate.memberId === memberId);

    try {
      const result = await postJson<{
        assignment: {
          blockId: string | null;
          blockStatus: OpsActionBlock["status"] | null;
          circleId: string;
          circleStatus: OpsActionCircle["status"];
          endedAt: string;
        };
      }>("/api/ops/circle-assignments", { memberId }, "PATCH");
      setEndedMemberIds((current) => new Set(current).add(memberId));
      setAssignedMemberIds((current) => {
        const next = new Set(current);
        next.delete(memberId);
        return next;
      });
      setCircles((current) =>
        current.map((candidate) =>
          candidate.id === result.assignment.circleId
            ? {
                ...candidate,
                activeMembers: Math.max(0, candidate.activeMembers - 1),
                blockStatus:
                  candidate.blockId === result.assignment.blockId
                    ? result.assignment.blockStatus
                    : candidate.blockStatus,
                status: result.assignment.circleStatus,
              }
            : candidate,
        ),
      );
      setEndAssignmentNotice({
        kind: "success",
        text: result.assignment.blockStatus === "archived"
          ? `${member?.name ?? "Member"} no longer has an active Circle assignment. Its Circle and Block closed because each no longer meets the minimum active group size.`
          : `${member?.name ?? "Member"} no longer has an active Circle assignment.`,
      });
      endAssignmentFormRef.current?.reset();
      router.refresh();
    } catch (error) {
      setEndAssignmentNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The Circle assignment could not be ended.",
      });
    } finally {
      setEndingAssignment(false);
    }
  }

  return (
    <section className="grid gap-4" aria-label="Circle administration">
      <section className="scroll-mt-40 rounded-[4px] bg-[var(--color-shop)]/25 p-5 sm:p-6" id="assign-member" aria-labelledby="assign-member-title">
        <h2 className="font-[var(--font-display)] text-2xl" id="assign-member-title">Assign a member</h2>
        <p className="mt-2 text-sm leading-relaxed text-black/60">
          Assign members first. A forming Circle can accept them now; activate it afterward when it is ready.
        </p>
        <form className="mt-5 grid gap-4" onSubmit={submitAssignment} ref={assignmentFormRef}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={OPERATOR_LABEL_CLASS}>
              <span className={OPERATOR_LABEL_TEXT_CLASS}>1. Choose member</span>
              <select
                aria-describedby="circle-member-help"
                className={INPUT_CLASS}
                disabled={assigning || eligibleMembers.length === 0}
                name="memberId"
                onChange={(event) => { setSelectedMemberId(event.target.value); setAssignmentNotice(null); }}
                required
                value={selectedMember?.memberId ?? ""}
              >
                <option className="bg-[var(--color-bone)]" disabled value="">Choose member</option>
                {selectedMember && selectedMemberIssue ? <option disabled value={selectedMember.memberId}>{selectedMember.name} · not ready for placement</option> : null}
                {eligibleMembers.map((member) => <option className="bg-[var(--color-bone)]" key={member.memberId} value={member.memberId}>{member.name}</option>)}
              </select>
            </label>
            <label className={OPERATOR_LABEL_CLASS}>
              <span className={OPERATOR_LABEL_TEXT_CLASS}>2. Choose Circle</span>
              <select
                aria-describedby="circle-space-help"
                className={INPUT_CLASS}
                disabled={assigning || acceptingCircles.length === 0}
                name="circleId"
                onChange={(event) => { setSelectedCircleId(event.target.value); setAssignmentNotice(null); }}
                required
                value={selectedCircle?.id ?? ""}
              >
                <option className="bg-[var(--color-bone)]" disabled value="">Choose Circle</option>
                {acceptingCircles.map((circle) => <option className="bg-[var(--color-bone)]" key={circle.id} value={circle.id}>{circle.name} · {circle.status} · {circle.capacity - circle.activeMembers} {circle.capacity - circle.activeMembers === 1 ? "space" : "spaces"}</option>)}
              </select>
            </label>
          </div>
          <div className="grid gap-3 text-sm leading-relaxed text-black/60 sm:grid-cols-2">
            <div aria-live="polite" id="circle-member-help">
              <p className={selectedMemberIssue ? "text-[var(--color-poster)]" : undefined}>
                {selectedMemberIssue ?? (eligibleMembers.length ? "Members need an active account, active billing, and an onboarding or active program." : "No members are ready for placement. Members need an active account, active billing, and an onboarding or active program, with no current Circle assignment.")}
              </p>
              {selectedMemberIssue && selectedMember ? (
                <Link className="mt-2 inline-block underline underline-offset-4" href={`/ops/members/${encodeURIComponent(selectedMember.memberId)}#membership`}>Review {selectedMember.name}’s membership →</Link>
              ) : null}
            </div>
            <div id="circle-space-help">
              {acceptingCircles.length ? (
                <p>{selectedCircle?.status === "forming" ? `${selectedCircle.name} is forming. Assign the member now, then activate it when ready.` : "Only forming or active Circles with open spaces are listed."}</p>
              ) : (
                <p>No Circles have an open space. <a className="underline underline-offset-4" href="#create-circle" onClick={() => setCreateOpen(true)}>Create a Circle</a> or review the existing assignments below.</p>
              )}
            </div>
          </div>
          <button
            className={`${BUTTON_CLASS} w-fit`}
            disabled={assigning || !selectedMember || Boolean(selectedMemberIssue) || !selectedCircle}
            type="submit"
          >
            {assigning ? "Assigning" : "3. Assign member"}
          </button>
          <Notice notice={assignmentNotice} />
        </form>
      </section>

      <details className="group scroll-mt-40 rounded-[4px] bg-black/[0.035]" id="create-circle" open={createOpen} onToggle={(event) => setCreateOpen(event.currentTarget.open)}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:content-none">
          <span className="ui-heading text-lg font-semibold">Create a Circle</span>
          <span aria-hidden="true" className="text-2xl group-open:rotate-45">+</span>
        </summary>
        <div className="px-5 pb-5">
          <p className="text-sm text-black/60">A new Circle starts in forming with ten member spaces.</p>
          <form className="mt-4 grid gap-3" onSubmit={submitCircle} ref={createFormRef}>
            <label className={OPERATOR_LABEL_CLASS} htmlFor="ops-circle-name">
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Circle name</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input className={INPUT_CLASS} disabled={creating} id="ops-circle-name" maxLength={80} minLength={2} name="name" placeholder="Circle 03" required />
              <button className={BUTTON_CLASS} disabled={creating} type="submit">{creating ? "Creating" : "Create Circle"}</button>
            </div>
            <Notice notice={createNotice} />
          </form>
        </div>
      </details>

      <section className="scroll-mt-40 rounded-[4px] bg-black/[0.035]" id="activate-circle" aria-labelledby="activate-circle-title">
        <h2 className="px-5 py-4 ui-heading text-lg font-semibold" id="activate-circle-title">Activate a Circle <span className="ml-2 text-sm font-normal text-black/50">After placement</span></h2>
        <div className="px-5 pb-5">
        <div className="grid gap-8 lg:grid-cols-[minmax(12rem,0.55fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <p className="max-w-md text-sm leading-relaxed text-black/60">
              At least one member must be assigned first. Activation then allows those members to complete Foundations.
            </p>
            {!activatableCircles.length ? <p className="mt-2 text-sm text-black/60">No forming Circle is ready yet. Place its first member above.</p> : null}
          </div>
          <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={submitActivation} ref={activationFormRef}>
            <label className={OPERATOR_LABEL_CLASS} htmlFor="ops-circle-activation">
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Forming Circle</span>
              <select
                className={INPUT_CLASS}
                disabled={activating || activatableCircles.length === 0}
                id="ops-circle-activation"
                name="circleId"
                onChange={(event) => setActivationCircleId(event.target.value)}
                required
                value={activatableCircles.some((circle) => circle.id === selectedActivationCircleId) ? selectedActivationCircleId : ""}
              >
                <option className="bg-[var(--color-bone)]" disabled value="">Choose forming Circle</option>
                {activatableCircles.map((circle) => (
                  <option className="bg-[var(--color-bone)]" key={circle.id} value={circle.id}>
                    {circle.name} · {circle.activeMembers}/{circle.capacity}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={BUTTON_CLASS}
              disabled={activating || !activatableCircles.some((circle) => circle.id === selectedActivationCircleId)}
              type="submit"
            >
              {activating ? "Activating" : "Activate Circle"}
            </button>
            <div className="sm:col-span-2"><Notice notice={activationNotice} /></div>
          </form>
        </div>
        </div>
      </section>

      <details className="group rounded-[4px] bg-black/[0.035]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:content-none">
          <span className="ui-heading text-lg font-semibold">End an assignment</span>
          <span aria-hidden="true" className="text-2xl group-open:rotate-45">+</span>
        </summary>
        <div className="px-5 pb-5">
        <div className="grid gap-8 lg:grid-cols-[minmax(12rem,0.55fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <p className="max-w-md text-sm leading-relaxed text-black/52">
              Remove a mistaken or obsolete active assignment. Completed Foundations keeps its historical Circle proof; an active Circle is archived if its last member leaves.
            </p>
          </div>
          <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={submitEndAssignment} ref={endAssignmentFormRef}>
            <label className={OPERATOR_LABEL_CLASS} htmlFor="ops-circle-assignment-end">
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Assigned member</span>
              <select
                className={INPUT_CLASS}
                defaultValue=""
                disabled={endingAssignment || assignedMembers.length === 0}
                id="ops-circle-assignment-end"
                name="memberId"
                required
              >
                <option className="bg-[var(--color-bone)]" disabled value="">Choose assigned member</option>
                {assignedMembers.map((member) => (
                  <option className="bg-[var(--color-bone)]" key={member.memberId} value={member.memberId}>
                    {member.name} · {member.circleName}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={SECONDARY_BUTTON_CLASS}
              disabled={endingAssignment || assignedMembers.length === 0}
              type="submit"
            >
              {endingAssignment ? "Ending" : "End assignment"}
            </button>
            <div className="sm:col-span-2"><Notice notice={endAssignmentNotice} /></div>
          </form>
        </div>
        </div>
      </details>
    </section>
  );
}

export function OpsBlockActions({
  circles: initialCircles,
  initialBlocks,
}: {
  circles: OpsActionCircle[];
  initialBlocks: OpsActionBlock[];
}) {
  const router = useRouter();
  const [blocks, setBlocks] = useState(initialBlocks);
  const [circles, setCircles] = useState(initialCircles);
  const [pendingAction, setPendingAction] = useState<
    "activate" | "assign" | "create" | "end" | null
  >(null);
  const [createNotice, setCreateNotice] = useState<ActionNotice>(null);
  const [assignmentNotice, setAssignmentNotice] = useState<ActionNotice>(null);
  const [activationNotice, setActivationNotice] = useState<ActionNotice>(null);
  const [endNotice, setEndNotice] = useState<ActionNotice>(null);

  useEffect(() => setBlocks(initialBlocks), [initialBlocks]);
  useEffect(() => setCircles(initialCircles), [initialCircles]);

  const acceptingBlocks = blocks.filter(
    (block) => block.status === "forming" || block.status === "active",
  );
  const availableCircles = circles.filter(
    (circle) =>
      !circle.blockId && (circle.status === "forming" || circle.status === "active"),
  );
  const activatableBlocks = blocks.filter(
    (block) => block.status === "forming" && block.currentCircles >= 2,
  );
  const assignedCircles = circles.filter((circle) => Boolean(circle.blockId));

  async function submitBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingAction("create");
    setCreateNotice(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get("name") ?? "");

    try {
      const result = await postJson<{ block: OpsActionBlock }>("/api/ops/blocks", { name });
      setBlocks((current) => [...current, result.block]);
      setCreateNotice({ kind: "success", text: `${result.block.name} created in forming state.` });
      formElement.reset();
      router.refresh();
    } catch (error) {
      setCreateNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The Block could not be created.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function submitAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingAction("assign");
    setAssignmentNotice(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const blockId = String(form.get("blockId") ?? "");
    const circleId = String(form.get("circleId") ?? "");
    const block = blocks.find((candidate) => candidate.id === blockId);
    const circle = circles.find((candidate) => candidate.id === circleId);

    try {
      const result = await postJson<{ assignment: { created: boolean } }>(
        "/api/ops/block-assignments",
        { blockId, circleId },
      );
      if (result.assignment.created && block && circle) {
        setBlocks((current) => current.map((candidate) =>
          candidate.id === blockId
            ? {
                ...candidate,
                circles: [
                  ...candidate.circles,
                  { id: circle.id, name: circle.name, status: circle.status },
                ],
                currentCircles: candidate.currentCircles + 1,
              }
            : candidate,
        ));
        setCircles((current) => current.map((candidate) =>
          candidate.id === circleId
            ? {
                ...candidate,
                blockId,
                blockName: block.name,
                blockStatus: block.status,
              }
            : candidate,
        ));
      }
      setAssignmentNotice({
        kind: "success",
        text: result.assignment.created
          ? `${circle?.name ?? "Circle"} assigned to ${block?.name ?? "Block"}.`
          : `${circle?.name ?? "Circle"} is already assigned to ${block?.name ?? "Block"}.`,
      });
      formElement.reset();
      router.refresh();
    } catch (error) {
      setAssignmentNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The Circle could not be assigned.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function submitActivation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingAction("activate");
    setActivationNotice(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const blockId = String(form.get("blockId") ?? "");
    const block = blocks.find((candidate) => candidate.id === blockId);

    try {
      const result = await postJson<{
        block: OpsActionBlock & { activated: boolean };
      }>("/api/ops/blocks", { blockId }, "PATCH");
      setBlocks((current) => current.map((candidate) =>
        candidate.id === blockId ? { ...candidate, status: "active" } : candidate,
      ));
      setCircles((current) => current.map((candidate) =>
        candidate.blockId === blockId ? { ...candidate, blockStatus: "active" } : candidate,
      ));
      setActivationNotice({
        kind: "success",
        text: result.block.activated
          ? `${block?.name ?? "Block"} is active.`
          : `${block?.name ?? "Block"} is already active.`,
      });
      formElement.reset();
      router.refresh();
    } catch (error) {
      setActivationNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The Block could not be activated.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function submitEndAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingAction("end");
    setEndNotice(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const circleId = String(form.get("circleId") ?? "");
    const circle = circles.find((candidate) => candidate.id === circleId);

    try {
      const result = await postJson<{
        assignment: {
          blockId: string;
          blockStatus: OpsActionBlock["status"];
          circleId: string;
        };
      }>("/api/ops/block-assignments", { circleId }, "PATCH");
      setBlocks((current) => current.map((candidate) =>
        candidate.id === result.assignment.blockId
          ? {
              ...candidate,
              circles: candidate.circles.filter((item) => item.id !== circleId),
              currentCircles: Math.max(0, candidate.currentCircles - 1),
              status: result.assignment.blockStatus,
            }
          : candidate,
      ));
      setCircles((current) => current.map((candidate) =>
        candidate.id === circleId
          ? { ...candidate, blockId: null, blockName: null, blockStatus: null }
          : candidate.blockId === result.assignment.blockId
            ? { ...candidate, blockStatus: result.assignment.blockStatus }
          : candidate,
      ));
      setEndNotice({
        kind: "success",
        text: result.assignment.blockStatus === "archived"
          ? `${circle?.name ?? "Circle"} no longer has a current Block assignment. The Block closed because fewer than two current Circles remain; all history stays recorded.`
          : `${circle?.name ?? "Circle"} no longer has a current Block assignment. Its history remains recorded.`,
      });
      formElement.reset();
      router.refresh();
    } catch (error) {
      setEndNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The Block assignment could not be ended.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <section className="grid gap-10 lg:grid-cols-2" aria-label="Block administration">
      <div>
        <h2 className="ui-heading text-xl font-semibold">Create a Block</h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-black/52">
          Create the larger group first. Its stable slug and forming state remain server-owned.
        </p>
        <form className="mt-5 grid gap-3" onSubmit={submitBlock}>
          <label className={OPERATOR_LABEL_CLASS} htmlFor="ops-block-name">
            <span className={OPERATOR_LABEL_TEXT_CLASS}>Block name</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              className={INPUT_CLASS}
              disabled={pendingAction === "create"}
              id="ops-block-name"
              maxLength={80}
              minLength={2}
              name="name"
              placeholder="Block 01"
              required
            />
            <button className={BUTTON_CLASS} disabled={pendingAction === "create"} type="submit">
              {pendingAction === "create" ? "Creating" : "Create Block"}
            </button>
          </div>
          <Notice notice={createNotice} />
        </form>
      </div>

      {blocks.length > 0 ? (
        <>
      <div>
        <h2 className="ui-heading text-xl font-semibold">Assign a Circle</h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-black/52">
          A Circle can have one current Block. Reassignment begins by ending its current relationship.
        </p>
        <form className="mt-6 grid gap-3" onSubmit={submitAssignment}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={OPERATOR_LABEL_CLASS}>
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Circle</span>
              <select className={INPUT_CLASS} defaultValue="" disabled={pendingAction === "assign" || availableCircles.length === 0} name="circleId" required>
                <option className="bg-[var(--color-bone)]" disabled value="">Choose Circle</option>
                {availableCircles.map((circle) => <option className="bg-[var(--color-bone)]" key={circle.id} value={circle.id}>{circle.name}</option>)}
              </select>
            </label>
            <label className={OPERATOR_LABEL_CLASS}>
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Block</span>
              <select className={INPUT_CLASS} defaultValue="" disabled={pendingAction === "assign" || acceptingBlocks.length === 0} name="blockId" required>
                <option className="bg-[var(--color-bone)]" disabled value="">Choose Block</option>
                {acceptingBlocks.map((block) => <option className="bg-[var(--color-bone)]" key={block.id} value={block.id}>{block.name} · {block.currentCircles} Circles</option>)}
              </select>
            </label>
          </div>
          <button className={`${BUTTON_CLASS} w-fit`} disabled={pendingAction === "assign" || availableCircles.length === 0 || acceptingBlocks.length === 0} type="submit">
            {pendingAction === "assign" ? "Assigning" : "Assign Circle"}
          </button>
          <Notice notice={assignmentNotice} />
        </form>
      </div>

      <div>
        <h2 className="ui-heading text-xl font-semibold">Activate a Block</h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-black/52">
          At least two current Circles are required. Block activation does not add a Foundations gate.
        </p>
        <form className="mt-6 grid gap-3" onSubmit={submitActivation}>
          <label className={OPERATOR_LABEL_CLASS}>
            <span className={OPERATOR_LABEL_TEXT_CLASS}>Forming Block</span>
            <select className={INPUT_CLASS} defaultValue="" disabled={pendingAction === "activate" || activatableBlocks.length === 0} name="blockId" required>
              <option className="bg-[var(--color-bone)]" disabled value="">Choose forming Block</option>
              {activatableBlocks.map((block) => <option className="bg-[var(--color-bone)]" key={block.id} value={block.id}>{block.name} · {block.currentCircles} Circles</option>)}
            </select>
          </label>
          <button className={`${BUTTON_CLASS} w-fit`} disabled={pendingAction === "activate" || activatableBlocks.length === 0} type="submit">
            {pendingAction === "activate" ? "Activating" : "Activate Block"}
          </button>
          <Notice notice={activationNotice} />
        </form>
      </div>

      <div>
        <h2 className="ui-heading text-xl font-semibold">End a Block assignment</h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-black/52">
          End only the current relationship. If fewer than two current Circles remain, the Block closes while its full history stays intact.
        </p>
        <form className="mt-6 grid gap-3" onSubmit={submitEndAssignment}>
          <label className={OPERATOR_LABEL_CLASS}>
            <span className={OPERATOR_LABEL_TEXT_CLASS}>Assigned Circle</span>
            <select className={INPUT_CLASS} defaultValue="" disabled={pendingAction === "end" || assignedCircles.length === 0} name="circleId" required>
              <option className="bg-[var(--color-bone)]" disabled value="">Choose assigned Circle</option>
              {assignedCircles.map((circle) => <option className="bg-[var(--color-bone)]" key={circle.id} value={circle.id}>{circle.name} · {circle.blockName}</option>)}
            </select>
          </label>
          <button className={`${SECONDARY_BUTTON_CLASS} w-fit`} disabled={pendingAction === "end" || assignedCircles.length === 0} type="submit">
            {pendingAction === "end" ? "Ending" : "End assignment"}
          </button>
          <Notice notice={endNotice} />
        </form>
      </div>
        </>
      ) : null}
    </section>
  );
}
