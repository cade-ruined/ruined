"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

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
  "min-h-12 border border-black/35 bg-transparent px-5 font-[var(--font-body)] text-[0.62rem] font-medium uppercase tracking-[0.15em] text-black/65 hover:border-black hover:text-black disabled:cursor-not-allowed disabled:border-black/15 disabled:text-black/25";

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
    <section aria-labelledby="invite-member-heading">
      <h2 className="sr-only" id="invite-member-heading">Invite a member</h2>
      <form className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end" onSubmit={submitInvitation} ref={formRef}>
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
            {pending ? "Recording" : "Record invitation"}
          </button>
          <button className={SECONDARY_BUTTON_CLASS} disabled={pending} name="intent" type="submit" value="revoke">
            Revoke live invite
          </button>
          <div className="sm:col-span-3"><Notice notice={notice} /></div>
      </form>
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
    <section className="grid gap-10 lg:grid-cols-2" aria-label="Circle administration">
      <div>
        <h2 className="ui-heading text-xl font-semibold">Create a Circle</h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-black/52">
          Name the Circle. Its slug, forming state, and ten-member capacity stay server-owned.
        </p>
        <form className="mt-5 grid gap-3" onSubmit={submitCircle} ref={createFormRef}>
          <label className={OPERATOR_LABEL_CLASS} htmlFor="ops-circle-name">
            <span className={OPERATOR_LABEL_TEXT_CLASS}>Circle name</span>
          </label>
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

      <div>
        <h2 className="ui-heading text-xl font-semibold">Assign a member</h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-black/52">
          Only unassigned members with active billing in onboarding or the active program appear here.
        </p>
        <form className="mt-6 grid gap-3" onSubmit={submitAssignment} ref={assignmentFormRef}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={OPERATOR_LABEL_CLASS}>
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Member</span>
              <select className={INPUT_CLASS} defaultValue="" disabled={assigning || eligibleMembers.length === 0} name="memberId" required>
                <option className="bg-[var(--color-bone)]" disabled value="">Choose member</option>
                {eligibleMembers.map((member) => <option className="bg-[var(--color-bone)]" key={member.memberId} value={member.memberId}>{member.name}</option>)}
              </select>
            </label>
            <label className={OPERATOR_LABEL_CLASS}>
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Circle</span>
              <select className={INPUT_CLASS} defaultValue="" disabled={assigning || acceptingCircles.length === 0} name="circleId" required>
                <option className="bg-[var(--color-bone)]" disabled value="">Choose Circle</option>
                {acceptingCircles.map((circle) => <option className="bg-[var(--color-bone)]" key={circle.id} value={circle.id}>{circle.name} · {circle.activeMembers}/{circle.capacity}</option>)}
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

      <div className="lg:col-span-2">
        <div className="grid gap-8 lg:grid-cols-[minmax(12rem,0.55fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <h2 className="ui-heading text-xl font-semibold">Activate a Circle</h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-black/52">
              Activation is deliberate. It allows assigned members to complete Foundations.
            </p>
          </div>
          <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={submitActivation} ref={activationFormRef}>
            <label className={OPERATOR_LABEL_CLASS} htmlFor="ops-circle-activation">
              <span className={OPERATOR_LABEL_TEXT_CLASS}>Forming Circle</span>
              <select
                className={INPUT_CLASS}
                defaultValue=""
                disabled={activating || activatableCircles.length === 0}
                id="ops-circle-activation"
                name="circleId"
                required
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
              disabled={activating || activatableCircles.length === 0}
              type="submit"
            >
              {activating ? "Activating" : "Activate Circle"}
            </button>
            <div className="sm:col-span-2"><Notice notice={activationNotice} /></div>
          </form>
        </div>
      </div>

      <div className="lg:col-span-2">
        <div className="grid gap-8 lg:grid-cols-[minmax(12rem,0.55fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <h2 className="ui-heading text-xl font-semibold">End an assignment</h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-black/52">
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
    </section>
  );
}
