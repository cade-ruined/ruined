"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";

import {
  OPERATOR_BUTTON_CLASS,
  OPERATOR_FIELD_CLASS,
  OPERATOR_LABEL_CLASS,
  OPERATOR_LABEL_TEXT_CLASS,
} from "@/components/platform/operatorStyles";
import type { OpsAnnouncementAudienceOptions, OpsAnnouncementSummary } from "@/lib/platform/ops-model";

class OperatorActionError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function actionRequest(url: string, body: unknown, method = "POST") {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  });
  const result = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    throw new OperatorActionError(typeof result?.error === "string" ? result.error : "The action could not be completed.", response.status);
  }
}

export function OperatorTaskAction({ state, taskId, claimedByName, claimedByCurrentOperator, expectedVersion, preview = false }: {
  state: string;
  taskId: string;
  claimedByName: string | null;
  claimedByCurrentOperator: boolean;
  expectedVersion: number;
  preview?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [messageVersion, setMessageVersion] = useState(expectedVersion);
  const [submitting, setSubmitting] = useState(false);
  const [settledVersion, setSettledVersion] = useState<number | null>(null);
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);
  const pending = useRef(false);
  const submittedVersion = useRef<number | null>(null);
  const canClaim = state === "open" && claimedByName === null && !claimedByCurrentOperator;
  const canComplete = claimedByCurrentOperator && (state === "open" || state === "in_progress");
  const canUnclaim = claimedByCurrentOperator && (state === "open" || state === "in_progress" || state === "blocked");
  const disabled = submitting || settledVersion === expectedVersion;
  const conflicted = conflictVersion === expectedVersion;

  async function act(action: "claim" | "unclaim" | "complete" | "reopen") {
    if (pending.current || submittedVersion.current === expectedVersion) return;
    if ((action === "claim" && !canClaim) || (action === "complete" && !canComplete)
      || (action === "unclaim" && !canUnclaim) || (action === "reopen" && state !== "completed")) return;
    setMessageVersion(expectedVersion);
    if (preview) { setMessage("Preview only — the task was not changed."); return; }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      setMessage("Refresh the queue before updating this task."); router.refresh(); return;
    }
    pending.current = true;
    setSubmitting(true);
    setMessage("");
    try {
      await actionRequest(`/api/ops/tasks/${taskId}`, { action, expectedVersion }, "PATCH");
      submittedVersion.current = expectedVersion;
      setSettledVersion(expectedVersion);
      setMessage(action === "complete" ? "Task completed." : action === "claim" ? "Task claimed." : action === "unclaim" ? "Task unclaimed. Another operator can take it." : "Task reopened and unclaimed.");
      router.refresh();
    } catch (error) {
      if (error instanceof OperatorActionError && error.status === 409) {
        submittedVersion.current = expectedVersion;
        setSettledVersion(expectedVersion);
        setConflictVersion(expectedVersion);
        setMessage("This task changed. Refreshing the queue—review its latest owner and status before trying again.");
        router.refresh();
      } else {
        setMessage(error instanceof Error ? error.message : "The task could not be updated. Try again.");
      }
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2" aria-busy={submitting}>
      {message && messageVersion === expectedVersion ? <p role="status" className="w-full max-w-md text-sm leading-relaxed text-[color:var(--operator-muted)] sm:text-right">{message}</p> : null}
      {canClaim ? <button className={OPERATOR_BUTTON_CLASS} disabled={disabled} onClick={() => act("claim")} type="button">Claim</button> : null}
      {canComplete ? <button className={OPERATOR_BUTTON_CLASS} disabled={disabled} onClick={() => act("complete")} type="button">Complete</button> : null}
      {canUnclaim ? <button className={OPERATOR_BUTTON_CLASS} disabled={disabled} onClick={() => act("unclaim")} type="button">Unclaim</button> : null}
      {state === "completed" ? <button className={OPERATOR_BUTTON_CLASS} disabled={disabled} onClick={() => act("reopen")} type="button">Reopen</button> : null}
      {conflicted ? <button className={OPERATOR_BUTTON_CLASS} onClick={() => router.refresh()} type="button">Refresh queue</button> : null}
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
      <span aria-live="polite" className="text-xs text-[color:var(--operator-muted)]">{message}</span>
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
      <span aria-live="polite" className="text-xs text-[color:var(--operator-muted)] sm:col-span-3">{message}</span>
    </form>
  );
}

export function OperatorAnnouncementCreateAction({
  audienceOptions,
  announcement,
  onSaved,
  onCancel,
  compact = false,
  preview = false,
}: {
  audienceOptions: OpsAnnouncementAudienceOptions;
  announcement?: OpsAnnouncementSummary;
  onSaved?: () => void;
  onCancel?: () => void;
  compact?: boolean;
  preview?: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const pendingRef = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    if (preview) { setMessage("Preview — announcement drafts are not saved."); return; }
    pendingRef.current = true;
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
      setDirty(false);
      setMessage(announcement ? "Draft saved. Review it before publishing." : "Draft announcement created.");
      onSaved?.();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The announcement could not be created.");
    } finally {
      pendingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form className={`grid gap-4 ${compact ? "" : "py-6"}`} data-operator-dirty={dirty} data-operator-pending={submitting} onChange={() => setDirty(true)} onSubmit={submit}>
      <fieldset className="contents" disabled={submitting}>
      {!compact ? <h2 className="ui-heading text-2xl font-semibold">{announcement ? "Edit draft" : "Create a draft"}</h2> : null}
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
        <span aria-live="polite" className="text-xs text-[color:var(--operator-muted)]">{message}</span>
        {onCancel ? <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} onClick={onCancel} type="button">Cancel editing</button> : null}
        <button className={OPERATOR_BUTTON_CLASS} disabled={preview || submitting} type="submit">{submitting ? "Saving" : announcement ? "Save draft" : "Create draft"}</button>
      </div>
      </fieldset>
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
      <span aria-live="polite" className="text-xs text-[color:var(--operator-muted)]">{message}</span>
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
    {reviewing ? <div className="rounded-none bg-[var(--operator-surface-muted)] p-3" role="group" aria-label={retract ? "Confirm retraction" : "Confirm discard"}>
      <p className="text-sm">{retract ? "Remove this post and its related alerts from the member app? Members may already have read it." : "Discard this draft? It will remain in history and cannot be published."}</p>
      {retract ? <label className={`${OPERATOR_LABEL_CLASS} mt-3`}><span className={OPERATOR_LABEL_TEXT_CLASS}>Reason</span><textarea className={OPERATOR_FIELD_CLASS} maxLength={1000} minLength={3} onChange={(event) => setReason(event.target.value)} value={reason} /></label> : null}
      <div className="mt-3 flex flex-wrap gap-3"><button className={OPERATOR_BUTTON_CLASS} disabled={preview || pending || (retract && reason.trim().length < 3)} onClick={close} type="button">{pending ? "Saving" : retract ? "Confirm retraction" : "Confirm discard"}</button><button className={OPERATOR_BUTTON_CLASS} disabled={pending} onClick={() => setReviewing(false)} type="button">Keep {retract ? "post" : "draft"}</button></div>
    </div> : <button className={OPERATOR_BUTTON_CLASS} onClick={() => setReviewing(true)} type="button">{retract ? "Retract post" : "Discard draft"}</button>}
    <p className="mt-2 text-sm text-[var(--operator-danger)]" role="status">{message}</p>
  </div>;
}
