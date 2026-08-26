"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import type { OperatorMemberSummary } from "@/lib/platform/model";

export type OpsActionCircle = {
  activeMembers: number;
  capacity: number;
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
        notice?.kind === "error" ? "text-[var(--color-poster)]" : "text-white/42"
      }`}
      role={notice?.kind === "error" ? "alert" : "status"}
    >
      {notice?.text ?? " "}
    </p>
  );
}

const INPUT_CLASS =
  "min-h-12 w-full border border-white/25 bg-transparent px-4 text-sm text-white outline-none placeholder:text-white/20 focus:border-white disabled:opacity-40";
const BUTTON_CLASS =
  "min-h-12 border border-white bg-white px-5 font-mono text-[0.58rem] uppercase tracking-[0.18em] text-black disabled:cursor-not-allowed disabled:border-white/20 disabled:bg-transparent disabled:text-white/30";
const SECONDARY_BUTTON_CLASS =
  "min-h-12 border border-white/25 bg-transparent px-5 font-mono text-[0.58rem] uppercase tracking-[0.18em] text-white/65 hover:border-white hover:text-white disabled:cursor-not-allowed disabled:border-white/15 disabled:text-white/20";

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
        text: `${result.invitation.reissued ? "Invitation reissued" : "Invitation recorded"} for ${result.invitation.email} through ${expiration}. No email was sent.`,
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
    <section className="border-y border-white/15 py-5" aria-labelledby="invite-member-heading">
      <div className="grid gap-8 lg:grid-cols-[minmax(12rem,0.55fr)_minmax(0,1fr)] lg:items-end">
        <div>
          <p className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-white/30">Admin action</p>
          <h2 className="ui-heading mt-3 text-2xl font-semibold" id="invite-member-heading">Invite a member</h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/42">
            Open passwordless eligibility for seven days. This records access but does not send an email.
          </p>
        </div>

        <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]" onSubmit={submitInvitation} ref={formRef}>
          <label className="sr-only" htmlFor="ops-invitation-email">Member email</label>
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
          <button className={BUTTON_CLASS} disabled={pending} name="intent" type="submit" value="record">
            {pending ? "Recording" : "Record invitation"}
          </button>
          <button className={SECONDARY_BUTTON_CLASS} disabled={pending} name="intent" type="submit" value="revoke">
            Revoke live invite
          </button>
          <div className="sm:col-span-3"><Notice notice={notice} /></div>
        </form>
      </div>
    </section>
  );
}

export function OpsCircleActions({
  initialCircles,
  members,
}: {
  initialCircles: OpsActionCircle[];
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

  useEffect(() => setCircles(initialCircles), [initialCircles]);

  const eligibleMembers = members.filter(
    (member) =>
      (!member.circleName || endedMemberIds.has(member.memberId)) &&
      !assignedMemberIds.has(member.memberId) &&
      member.billingState === "active" &&
      (member.programState === "onboarding" || member.programState === "active"),
  );
  const acceptingCircles = circles.filter(
    (circle) =>
      (circle.status === "forming" || circle.status === "active") &&
      circle.activeMembers < circle.capacity,
  );
  const activatableCircles = circles.filter(
    (circle) => circle.status === "forming" && circle.activeMembers > 0,
  );
  const assignedMembers = members.filter(
    (member) => Boolean(member.circleName) && !endedMemberIds.has(member.memberId),
  );

  async function submitCircle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCreateNotice(null);

    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");

    try {
      const result = await postJson<{ circle: OpsActionCircle }>("/api/ops/circles", { name });
      setCircles((current) => [...current, result.circle]);
      setCreateNotice({ kind: "success", text: `${result.circle.name} created with ${result.circle.capacity} positions.` });
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
    const circle = circles.find((candidate) => candidate.id === circleId);

    try {
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
          ? `${member?.name ?? "Member"} assigned to ${circle?.name ?? "Circle"}.`
          : `${member?.name ?? "Member"} is already assigned to ${circle?.name ?? "Circle"}.`,
      });
      assignmentFormRef.current?.reset();
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
        assignment: { circleId: string; circleStatus: OpsActionCircle["status"]; endedAt: string };
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
                status: result.assignment.circleStatus,
              }
            : candidate,
        ),
      );
      setEndAssignmentNotice({
        kind: "success",
        text: `${member?.name ?? "Member"} no longer has an active Circle assignment.`,
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
    <section className="grid border-y border-white/15 lg:grid-cols-2" aria-label="Circle administration">
      <div className="py-6 lg:pr-10">
        <p className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-white/30">Admin action</p>
        <h2 className="ui-heading mt-3 text-2xl font-semibold">Create a Circle</h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-white/42">
          Name the Circle. Its slug, forming state, and ten-member capacity stay server-owned.
        </p>
        <form className="mt-6 grid gap-3" onSubmit={submitCircle} ref={createFormRef}>
          <label className="sr-only" htmlFor="ops-circle-name">Circle name</label>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              className={INPUT_CLASS}
              disabled={creating}
              id="ops-circle-name"
              maxLength={80}
              minLength={2}
              name="name"
              placeholder="Circle 03"
              required
            />
            <button className={BUTTON_CLASS} disabled={creating} type="submit">
              {creating ? "Creating" : "Create Circle"}
            </button>
          </div>
          <Notice notice={createNotice} />
        </form>
      </div>

      <div className="border-t border-white/15 py-6 lg:border-l lg:border-t-0 lg:border-white/15 lg:pl-10">
        <p className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-white/30">Admin action</p>
        <h2 className="ui-heading mt-3 text-2xl font-semibold">Assign a member</h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-white/42">
          Only unassigned members with active billing in onboarding or the active program appear here.
        </p>
        <form className="mt-6 grid gap-3" onSubmit={submitAssignment} ref={assignmentFormRef}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-2 font-mono text-[0.53rem] uppercase tracking-[0.16em] text-white/38">
              Member
              <select className={INPUT_CLASS} defaultValue="" disabled={assigning || eligibleMembers.length === 0} name="memberId" required>
                <option className="bg-[#080605]" disabled value="">Choose member</option>
                {eligibleMembers.map((member) => <option className="bg-[#080605]" key={member.memberId} value={member.memberId}>{member.name}</option>)}
              </select>
            </label>
            <label className="grid gap-2 font-mono text-[0.53rem] uppercase tracking-[0.16em] text-white/38">
              Circle
              <select className={INPUT_CLASS} defaultValue="" disabled={assigning || acceptingCircles.length === 0} name="circleId" required>
                <option className="bg-[#080605]" disabled value="">Choose Circle</option>
                {acceptingCircles.map((circle) => <option className="bg-[#080605]" key={circle.id} value={circle.id}>{circle.name} · {circle.activeMembers}/{circle.capacity}</option>)}
              </select>
            </label>
          </div>
          <button
            className={`${BUTTON_CLASS} w-fit`}
            disabled={assigning || eligibleMembers.length === 0 || acceptingCircles.length === 0}
            type="submit"
          >
            {assigning ? "Assigning" : "Assign member"}
          </button>
          <Notice notice={assignmentNotice} />
        </form>
      </div>

      <div className="border-t border-white/15 py-6 lg:col-span-2">
        <div className="grid gap-8 lg:grid-cols-[minmax(12rem,0.55fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <p className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-white/30">Completion authority</p>
            <h2 className="ui-heading mt-3 text-2xl font-semibold">Activate a Circle</h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-white/42">
              Activation is deliberate. It allows assigned members to complete Foundations.
            </p>
          </div>
          <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={submitActivation} ref={activationFormRef}>
            <label className="sr-only" htmlFor="ops-circle-activation">Forming Circle</label>
            <select
              className={INPUT_CLASS}
              defaultValue=""
              disabled={activating || activatableCircles.length === 0}
              id="ops-circle-activation"
              name="circleId"
              required
            >
              <option className="bg-[#080605]" disabled value="">Choose forming Circle</option>
              {activatableCircles.map((circle) => (
                <option className="bg-[#080605]" key={circle.id} value={circle.id}>
                  {circle.name} · {circle.activeMembers}/{circle.capacity}
                </option>
              ))}
            </select>
            <button
              className={BUTTON_CLASS}
              disabled={activating || activatableCircles.length === 0}
              type="submit"
            >
              {activating ? "Activating" : "Activate Circle"}
            </button>
            <div className="sm:col-span-2"><Notice notice={activationNotice} /></div>
          </form>
        </div>
      </div>

      <div className="border-t border-white/15 py-6 lg:col-span-2">
        <div className="grid gap-8 lg:grid-cols-[minmax(12rem,0.55fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <p className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-white/30">Correction</p>
            <h2 className="ui-heading mt-3 text-2xl font-semibold">End an assignment</h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-white/42">
              Remove a mistaken or obsolete active assignment. Completed Foundations keeps its historical Circle proof; an active Circle is archived if its last member leaves.
            </p>
          </div>
          <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={submitEndAssignment} ref={endAssignmentFormRef}>
            <label className="sr-only" htmlFor="ops-circle-assignment-end">Assigned member</label>
            <select
              className={INPUT_CLASS}
              defaultValue=""
              disabled={endingAssignment || assignedMembers.length === 0}
              id="ops-circle-assignment-end"
              name="memberId"
              required
            >
              <option className="bg-[#080605]" disabled value="">Choose assigned member</option>
              {assignedMembers.map((member) => (
                <option className="bg-[#080605]" key={member.memberId} value={member.memberId}>
                  {member.name} · {member.circleName}
                </option>
              ))}
            </select>
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
    </section>
  );
}
