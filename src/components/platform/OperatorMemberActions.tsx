"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import {
  OPERATOR_BUTTON_CLASS,
  OPERATOR_FIELD_CLASS,
  OPERATOR_LABEL_CLASS,
  OPERATOR_LABEL_TEXT_CLASS,
} from "@/components/platform/operatorStyles";
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
        <h3 className="ui-heading text-xl font-semibold">Add a note</h3>
        <span className="text-xs text-black/38">Internal only</span>
      </div>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Category</span>
        <select className={OPERATOR_FIELD_CLASS} defaultValue="general" name="category">
          <option value="general">General</option>
          <option value="outreach">Outreach</option>
          <option value="support">Support</option>
          <option value="risk">Risk</option>
          <option value="logistics">Logistics</option>
          <option value="circle">Circle</option>
        </select>
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Internal note</span>
        <textarea
          className={`${OPERATOR_FIELD_CLASS} min-h-28 resize-y`}
          maxLength={2000}
          minLength={3}
          name="body"
          required
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ActionNotice notice={notice} />
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} type="submit">
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
      <h3 className="ui-heading text-xl font-semibold">Create a task</h3>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Title</span>
        <input className={OPERATOR_FIELD_CLASS} maxLength={200} minLength={3} name="title" required />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Priority</span>
          <select className={OPERATOR_FIELD_CLASS} defaultValue="normal" name="priority">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Due date / optional</span>
          <input className={OPERATOR_FIELD_CLASS} name="dueAt" type="date" />
        </label>
      </div>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Details / optional</span>
        <textarea className={`${OPERATOR_FIELD_CLASS} min-h-24 resize-y`} maxLength={2000} name="description" />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ActionNotice notice={notice} />
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} type="submit">
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
        <h3 className="ui-heading text-xl font-semibold">Record a state correction</h3>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-black/48">
          Payment, agreements, and Foundations completion cannot be overridden here. Every correction keeps its actor, reason, and prior state.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>What changed?</span>
          <select
            className={OPERATOR_FIELD_CLASS}
            name="dimension"
            onChange={(event) => setDimension(event.target.value)}
            value={dimension}
          >
            <option value="standing">Standing</option>
            <option value="account">Member account</option>
            <option value="admission">Admission</option>
            <option value="administrative_onboarding">Administrative onboarding</option>
            <option value="artifact">Artifact</option>
          </select>
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Correct status</span>
          <select className={OPERATOR_FIELD_CLASS} defaultValue="" key={dimension} name="nextState" required>
            <option disabled value="">Choose state</option>
            {OVERRIDE_STATES[dimension].map((state) => (
              <option key={state.value} value={state.value}>{state.label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Reason category</span>
        <select className={OPERATOR_FIELD_CLASS} defaultValue="operator_correction" name="reasonCode">
          <option value="operator_correction">Operator correction</option>
          <option value="member_request">Member request</option>
          <option value="policy_exception">Approved policy exception</option>
          <option value="data_repair">Data repair</option>
        </select>
      </label>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Reason</span>
        <textarea
          className={`${OPERATOR_FIELD_CLASS} min-h-28 resize-y`}
          maxLength={1000}
          minLength={12}
          name="reason"
          required
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ActionNotice notice={notice} />
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} type="submit">
          {submitting ? "Recording" : "Record correction"}
        </button>
      </div>
    </form>
  );
}
