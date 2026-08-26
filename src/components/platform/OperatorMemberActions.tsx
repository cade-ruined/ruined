"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import type { OpsMemberRecord } from "@/lib/platform/ops-model";

const INPUT_CLASS =
  "min-h-12 w-full border border-black/30 bg-transparent px-4 py-3 text-sm text-black outline-none placeholder:text-black/35 focus:border-black";
const BUTTON_CLASS =
  "min-h-12 border border-black bg-black px-5 text-[0.64rem] font-medium uppercase tracking-[0.15em] text-[var(--color-bone)] transition-colors hover:bg-[var(--color-poster)] disabled:cursor-not-allowed disabled:opacity-40";

type Notice = { kind: "error" | "success"; text: string } | null;

function ActionNotice({ notice }: { notice: Notice }) {
  return (
    <p
      aria-live="polite"
      className={`min-h-5 text-xs leading-relaxed ${
        notice?.kind === "error" ? "text-[var(--color-poster)]" : "text-black/48"
      }`}
      role="status"
    >
      {notice?.text ?? ""}
    </p>
  );
}

async function sendJson(url: string, body: unknown, method = "POST") {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
  const result = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof result?.error === "string" ? result.error : "The action could not be completed.");
  }
  return result;
}

export function OperatorNoteAction({ memberId }: { memberId: string }) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      await sendJson(`/api/ops/members/${memberId}/notes`, {
        body: String(data.get("body") ?? ""),
        category: String(data.get("category") ?? "general"),
      });
      form.reset();
      setNotice({ kind: "success", text: "The note was added to the operating record." });
      router.refresh();
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The note could not be added.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4 border-t border-black/20 pt-6" onSubmit={submit}>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-black/42">Operator action</p>
          <h3 className="ui-heading mt-2 text-xl font-semibold">Add a note</h3>
        </div>
        <span className="text-xs text-black/38">Internal only</span>
      </div>
      <label className="grid gap-2 text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/50">
        Note type
        <select className={INPUT_CLASS} defaultValue="general" name="category">
          <option value="general">General</option>
          <option value="outreach">Outreach</option>
          <option value="support">Support</option>
          <option value="risk">Risk</option>
          <option value="logistics">Logistics</option>
          <option value="circle">Circle</option>
        </select>
      </label>
      <label className="grid gap-2 text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/50">
        Note
        <textarea
          className={`${INPUT_CLASS} min-h-28 resize-y normal-case tracking-normal`}
          maxLength={2000}
          minLength={3}
          name="body"
          placeholder="Record the useful context, not a private reflection."
          required
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ActionNotice notice={notice} />
        <button className={BUTTON_CLASS} disabled={submitting} type="submit">
          {submitting ? "Adding note" : "Add note"}
        </button>
      </div>
    </form>
  );
}

export function OperatorTaskCreateAction({ memberId }: { memberId: string }) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await sendJson("/api/ops/tasks", {
        description: String(data.get("description") ?? ""),
        dueAt: String(data.get("dueAt") ?? ""),
        memberId,
        priority: String(data.get("priority") ?? "normal"),
        title: String(data.get("title") ?? ""),
      });
      form.reset();
      setNotice({ kind: "success", text: "The operator task was created." });
      router.refresh();
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The task could not be created.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4 border-t border-black/20 pt-6" onSubmit={submit}>
      <div>
        <p className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-black/42">Operator action</p>
        <h3 className="ui-heading mt-2 text-xl font-semibold">Create a task</h3>
      </div>
      <label className="grid gap-2 text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/50">
        Task
        <input className={INPUT_CLASS} maxLength={200} minLength={3} name="title" required />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2 text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/50">
          Priority
          <select className={INPUT_CLASS} defaultValue="normal" name="priority">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        <label className="grid gap-2 text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/50">
          Due
          <input className={INPUT_CLASS} name="dueAt" type="date" />
        </label>
      </div>
      <label className="grid gap-2 text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/50">
        Useful context
        <textarea className={`${INPUT_CLASS} min-h-24 resize-y normal-case tracking-normal`} maxLength={2000} name="description" />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ActionNotice notice={notice} />
        <button className={BUTTON_CLASS} disabled={submitting} type="submit">
          {submitting ? "Creating" : "Create task"}
        </button>
      </div>
    </form>
  );
}

const OVERRIDE_STATES: Record<string, Array<{ label: string; value: string }>> = {
  account: [
    { label: "Provisional", value: "provisional" },
    { label: "Invited", value: "invited" },
    { label: "Active", value: "active" },
    { label: "Suspended", value: "suspended" },
    { label: "Closed", value: "closed" },
  ],
  admission: [
    { label: "Interested", value: "interested" },
    { label: "Applied", value: "applied" },
    { label: "Invited", value: "invited" },
    { label: "Accepted", value: "accepted" },
    { label: "Declined", value: "declined" },
    { label: "Withdrawn", value: "withdrawn" },
  ],
  administrative_onboarding: [
    { label: "Not started", value: "not_started" },
    { label: "In progress", value: "in_progress" },
    { label: "Complete", value: "completed" },
  ],
  standing: [
    { label: "Pre-active", value: "pre_active" },
    { label: "Active", value: "active" },
    { label: "Paused", value: "paused" },
    { label: "Cancellation requested", value: "cancellation_requested" },
    { label: "Inactive", value: "inactive" },
    { label: "Alumni", value: "alumni" },
  ],
  artifact: [
    { label: "Not started", value: "not_started" },
    { label: "Collecting", value: "collecting" },
    { label: "In production", value: "in_production" },
    { label: "Fulfilled", value: "fulfilled" },
  ],
  progression: [
    { label: "Member", value: "member" },
    { label: "Shaper", value: "shaper" },
    { label: "Builder", value: "builder" },
    { label: "Author", value: "author" },
    { label: "Partner", value: "partner" },
  ],
};

export function OperatorOverrideAction({
  lifecycleVersion,
  memberId,
}: {
  lifecycleVersion: number;
  memberId: string;
}) {
  const router = useRouter();
  const [dimension, setDimension] = useState("standing");
  const [notice, setNotice] = useState<Notice>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      await sendJson(`/api/ops/members/${memberId}/state-overrides`, {
        dimension,
        expectedLifecycleVersion: lifecycleVersion,
        nextState: String(data.get("nextState") ?? ""),
        reason: String(data.get("reason") ?? ""),
        reasonCode: String(data.get("reasonCode") ?? "operator_correction"),
      });
      form.reset();
      setNotice({ kind: "success", text: "The audited correction was recorded." });
      router.refresh();
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The correction could not be recorded.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4 border-t border-black/20 pt-6" onSubmit={submit}>
      <div>
        <p className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-[var(--color-poster)]">Restricted action</p>
        <h3 className="ui-heading mt-2 text-xl font-semibold">Record a state correction</h3>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-black/48">
          Payment, agreements, and Foundations completion cannot be overridden here. Every correction keeps its actor, reason, and prior state.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2 text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/50">
          Dimension
          <select
            className={INPUT_CLASS}
            name="dimension"
            onChange={(event) => setDimension(event.target.value)}
            value={dimension}
          >
            <option value="standing">Standing</option>
            <option value="account">Member account</option>
            <option value="admission">Admission</option>
            <option value="administrative_onboarding">Administrative onboarding</option>
            <option value="artifact">Artifact</option>
            <option value="progression">Progression</option>
          </select>
        </label>
        <label className="grid gap-2 text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/50">
          Correct state
          <select className={INPUT_CLASS} defaultValue="" key={dimension} name="nextState" required>
            <option disabled value="">Choose state</option>
            {OVERRIDE_STATES[dimension].map((state) => (
              <option key={state.value} value={state.value}>{state.label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-2 text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/50">
        Reason code
        <select className={INPUT_CLASS} defaultValue="operator_correction" name="reasonCode">
          <option value="operator_correction">Operator correction</option>
          <option value="member_request">Member request</option>
          <option value="policy_exception">Approved policy exception</option>
          <option value="data_repair">Data repair</option>
        </select>
      </label>
      <label className="grid gap-2 text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/50">
        Written reason
        <textarea
          className={`${INPUT_CLASS} min-h-28 resize-y normal-case tracking-normal`}
          maxLength={1000}
          minLength={12}
          name="reason"
          placeholder="Explain why this correction is justified."
          required
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ActionNotice notice={notice} />
        <button className={BUTTON_CLASS} disabled={submitting} type="submit">
          {submitting ? "Recording" : "Record correction"}
        </button>
      </div>
    </form>
  );
}

export function OperatorAccountabilityAction({ record }: { record: OpsMemberRecord }) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);
  const [submitting, setSubmitting] = useState(false);
  const circle = record.community.circle;
  if (!circle) return null;
  const circleId = circle.circleId;

  const availablePartners = circle.members.filter(
    (member) => member.memberId !== record.header.memberId,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      await sendJson("/api/ops/accountability-partners", {
        circleId,
        memberId: record.header.memberId,
        partnerMemberId: String(data.get("partnerMemberId") ?? ""),
      });
      setNotice({ kind: "success", text: "The accountability pairing was recorded." });
      router.refresh();
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : "The pairing could not be recorded.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4 border-t border-black/20 pt-6" onSubmit={submit}>
      <div>
        <p className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-black/42">Circle action</p>
        <h3 className="ui-heading mt-2 text-xl font-semibold">Accountability partner</h3>
      </div>
      <label className="grid gap-2 text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/50">
        Partner in {circle.name}
        <select className={INPUT_CLASS} defaultValue="" disabled={availablePartners.length === 0 || submitting} name="partnerMemberId" required>
          <option disabled value="">Choose member</option>
          {availablePartners.map((member) => (
            <option key={member.memberId} value={member.memberId}>{member.preferredName}</option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ActionNotice notice={notice} />
        <button className={BUTTON_CLASS} disabled={availablePartners.length === 0 || submitting} type="submit">
          {submitting ? "Assigning" : "Assign partner"}
        </button>
      </div>
    </form>
  );
}
