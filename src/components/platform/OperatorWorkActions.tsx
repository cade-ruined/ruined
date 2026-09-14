"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import {
  OPERATOR_BUTTON_CLASS,
  OPERATOR_FIELD_CLASS,
  OPERATOR_LABEL_CLASS,
  OPERATOR_LABEL_TEXT_CLASS,
} from "@/components/platform/operatorStyles";
import type { OpsAnnouncementAudienceOptions, OpsAnnouncementSummary } from "@/lib/platform/ops-model";

async function actionRequest(url: string, body: unknown, method = "POST") {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
  const result = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof result?.error === "string" ? result.error : "The action could not be completed.");
  }
}

export function OperatorTaskAction({ state, taskId, preview = false }: { state: string; taskId: string; preview?: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function act(action: "claim" | "complete" | "reopen") {
    if (preview) { setMessage("Preview only — the task was not changed."); return; }
    setSubmitting(true);
    setMessage("");
    try {
      await actionRequest(`/api/ops/tasks/${taskId}`, { action }, "PATCH");
      setMessage(action === "complete" ? "Task completed." : action === "claim" ? "Task claimed." : "Task reopened.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The task could not be updated.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span aria-live="polite" className="text-xs text-black/42">{message}</span>
      {state === "open" ? (
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} onClick={() => act("claim")} type="button">Claim</button>
      ) : null}
      {state === "open" || state === "in_progress" ? (
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} onClick={() => act("complete")} type="button">Complete</button>
      ) : null}
      {state === "completed" ? (
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} onClick={() => act("reopen")} type="button">Reopen</button>
      ) : null}
    </div>
  );
}

export function OperatorWorkflowRetryAction({ workflowActionId, preview = false }: { workflowActionId: string; preview?: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function retry() {
    if (preview) { setMessage("Preview only — no retry was queued."); return; }
    setSubmitting(true);
    setMessage("");
    try {
      await actionRequest(`/api/ops/workflow-actions/${workflowActionId}/retry`, {});
      setMessage("Retry queued.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The retry could not be queued.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <span aria-live="polite" className="text-xs text-black/42">{message}</span>
      <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} onClick={retry} type="button">
        {submitting ? "Queuing" : "Queue retry"}
      </button>
    </div>
  );
}

const ARTIFACT_TRANSITIONS: Record<string, string[]> = {
  collecting: ["ready_for_production", "canceled"],
  in_production: ["review", "canceled"],
  ready: ["fulfilled"],
  ready_for_production: ["in_production", "canceled"],
  requested: ["collecting", "canceled"],
  review: ["ready", "in_production", "canceled"],
};

export function OperatorArtifactAction({ artifactJobId, state, preview = false }: { artifactJobId: string; state: string; preview?: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const transitions = ARTIFACT_TRANSITIONS[state] ?? [];
  if (transitions.length === 0) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview) { setMessage("Preview only — production was not changed."); return; }
    setSubmitting(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      await actionRequest(`/api/ops/artifact-jobs/${artifactJobId}`, {
        nextState: String(data.get("nextState") ?? ""),
        reason: String(data.get("reason") ?? ""),
      }, "PATCH");
      setMessage("Artifact work updated.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Artifact could not be updated.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-2 sm:grid-cols-[minmax(10rem,0.45fr)_minmax(12rem,1fr)_auto]" onSubmit={submit}>
      <label className={OPERATOR_LABEL_CLASS} htmlFor={`artifact-state-${artifactJobId}`}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Status</span>
        <select className={OPERATOR_FIELD_CLASS} defaultValue="" id={`artifact-state-${artifactJobId}`} name="nextState" required>
          <option disabled value="">Choose status</option>
          {transitions.map((transition) => (
            <option key={transition} value={transition}>{transition.replaceAll("_", " ")}</option>
          ))}
        </select>
      </label>
      <label className={OPERATOR_LABEL_CLASS} htmlFor={`artifact-reason-${artifactJobId}`}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Production note</span>
        <input className={OPERATOR_FIELD_CLASS} id={`artifact-reason-${artifactJobId}`} maxLength={500} minLength={3} name="reason" required />
      </label>
      <button className={`${OPERATOR_BUTTON_CLASS} self-end`} disabled={submitting} type="submit">Update</button>
      <span aria-live="polite" className="text-xs text-black/42 sm:col-span-3">{message}</span>
    </form>
  );
}

export function OperatorAnnouncementCreateAction({
  audienceOptions,
  announcement,
  onSaved,
  onCancel,
  preview = false,
}: {
  audienceOptions: OpsAnnouncementAudienceOptions;
  announcement?: OpsAnnouncementSummary;
  onSaved?: () => void;
  onCancel?: () => void;
  preview?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview) { setMessage("Preview — announcement drafts are not saved."); return; }
    setSubmitting(true);
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const [targetKind, targetId = ""] = String(data.get("audience") ?? "").split(":");
    try {
      await actionRequest(announcement ? `/api/ops/announcements/${announcement.announcementId}` : "/api/ops/announcements", {
        ...(announcement ? { action: "edit", expectedVersion: announcement.version } : {}),
        body: String(data.get("body") ?? ""),
        ...(targetKind === "keep" ? {} : { targetId, targetKind }),
        title: String(data.get("title") ?? ""),
      }, announcement ? "PATCH" : "POST");
      form.reset();
      setMessage(announcement ? "Draft saved. Review it before publishing." : "Draft announcement created.");
      onSaved?.();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The announcement could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4 border-y border-black/25 py-6" onSubmit={submit}>
      <h2 className="ui-heading text-2xl font-semibold">{announcement ? "Edit draft" : "Create a draft"}</h2>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,0.4fr)]">
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Title</span>
          <input className={OPERATOR_FIELD_CLASS} defaultValue={announcement?.title} maxLength={200} minLength={3} name="title" required />
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Audience</span>
          <select className={OPERATOR_FIELD_CLASS} defaultValue={announcement ? "keep:" : ""} name="audience" required>
            {announcement ? <option value="keep:">Keep: {announcement.targetLabel}</option> : <option disabled value="">Choose audience</option>}
            <option value="all_active_members:">All active members</option>
            <optgroup label="Circles">
              {audienceOptions.circles.map((circle) => <option key={circle.id} value={`circle:${circle.id}`}>{circle.label}</option>)}
            </optgroup>
            <optgroup label="Blocks">
              {audienceOptions.blocks.map((block) => <option key={block.id} value={`block:${block.id}`}>{block.label}</option>)}
            </optgroup>
            <optgroup label="One member">
              {audienceOptions.members.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.label}</option>)}
            </optgroup>
          </select>
        </label>
      </div>
      <label className={OPERATOR_LABEL_CLASS}>
        <span className={OPERATOR_LABEL_TEXT_CLASS}>Announcement</span>
        <textarea className={`${OPERATOR_FIELD_CLASS} min-h-32 resize-y`} defaultValue={announcement?.body} maxLength={10000} minLength={3} name="body" required />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span aria-live="polite" className="text-xs text-black/42">{message}</span>
        {onCancel ? <button className="min-h-11 text-sm underline" disabled={submitting} onClick={onCancel} type="button">Cancel editing</button> : null}
        <button className={OPERATOR_BUTTON_CLASS} disabled={preview || submitting} type="submit">{submitting ? "Saving" : announcement ? "Save draft" : "Create draft"}</button>
      </div>
    </form>
  );
}

export function OperatorAnnouncementPublishAction({ announcementId, expectedVersion, preview = false }: { announcementId: string; expectedVersion: number; preview?: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function publish() {
    if (preview) { setMessage("Preview — announcements are not published."); return; }
    setSubmitting(true);
    setMessage("");
    try {
      await actionRequest(`/api/ops/announcements/${announcementId}/publish`, { expectedVersion });
      setMessage("Published.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The announcement could not be published.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <span aria-live="polite" className="text-xs text-black/42">{message}</span>
      <button className={OPERATOR_BUTTON_CLASS} disabled={preview || submitting} onClick={publish} type="button">{submitting ? "Publishing" : "Publish"}</button>
    </div>
  );
}

export function OperatorAnnouncementCloseAction({ announcement, preview = false }: { announcement: OpsAnnouncementSummary; preview?: boolean }) {
  const router = useRouter();
  const [reviewing, setReviewing] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const retract = announcement.state === "published";
  async function close() {
    if (preview) { setMessage("Preview — nothing was changed."); return; }
    setPending(true); setMessage("");
    try {
      await actionRequest(`/api/ops/announcements/${announcement.announcementId}`, { action: retract ? "retract" : "discard", expectedVersion: announcement.version, ...(retract ? { reason } : {}) }, "PATCH");
      setReviewing(false); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The announcement could not be changed."); }
    finally { setPending(false); }
  }
  return <div className="mt-3">
    {reviewing ? <div className="rounded-[4px] bg-black/5 p-3" role="group" aria-label={retract ? "Confirm retraction" : "Confirm discard"}>
      <p className="text-sm">{retract ? "Remove this post and its related alerts from the member app? Members may already have read it." : "Discard this draft? It will remain in history and cannot be published."}</p>
      {retract ? <label className={`${OPERATOR_LABEL_CLASS} mt-3`}><span className={OPERATOR_LABEL_TEXT_CLASS}>Reason</span><textarea className={OPERATOR_FIELD_CLASS} maxLength={1000} minLength={3} onChange={(event) => setReason(event.target.value)} value={reason} /></label> : null}
      <div className="mt-3 flex flex-wrap gap-3"><button className={OPERATOR_BUTTON_CLASS} disabled={preview || pending || (retract && reason.trim().length < 3)} onClick={close} type="button">{pending ? "Saving" : retract ? "Confirm retraction" : "Confirm discard"}</button><button className="min-h-11 text-sm underline" disabled={pending} onClick={() => setReviewing(false)} type="button">Keep {retract ? "post" : "draft"}</button></div>
    </div> : <button className="min-h-11 text-sm text-[var(--color-poster)] underline underline-offset-4" onClick={() => setReviewing(true)} type="button">{retract ? "Retract post" : "Discard draft"}</button>}
    <p className="mt-2 text-sm text-[var(--color-poster)]" role="status">{message}</p>
  </div>;
}
