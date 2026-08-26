"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

const INPUT_CLASS =
  "min-h-12 w-full border border-black/30 bg-transparent px-4 py-3 text-sm text-black outline-none placeholder:text-black/35 focus:border-black";
const BUTTON_CLASS =
  "min-h-11 border border-black bg-black px-4 text-[0.62rem] font-medium uppercase tracking-[0.14em] text-[var(--color-bone)] transition-colors hover:bg-[var(--color-poster)] disabled:cursor-not-allowed disabled:opacity-40";

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

export function OperatorTaskAction({ state, taskId }: { state: string; taskId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function act(action: "claim" | "complete" | "reopen") {
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
        <button className={BUTTON_CLASS} disabled={submitting} onClick={() => act("claim")} type="button">Claim</button>
      ) : null}
      {state === "open" || state === "in_progress" ? (
        <button className={BUTTON_CLASS} disabled={submitting} onClick={() => act("complete")} type="button">Complete</button>
      ) : null}
      {state === "completed" ? (
        <button className={BUTTON_CLASS} disabled={submitting} onClick={() => act("reopen")} type="button">Reopen</button>
      ) : null}
    </div>
  );
}

export function OperatorWorkflowRetryAction({ workflowActionId }: { workflowActionId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function retry() {
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
      <button className={BUTTON_CLASS} disabled={submitting} onClick={retry} type="button">
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

export function OperatorArtifactAction({ artifactJobId, state }: { artifactJobId: string; state: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const transitions = ARTIFACT_TRANSITIONS[state] ?? [];
  if (transitions.length === 0) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      <label className="sr-only" htmlFor={`artifact-state-${artifactJobId}`}>Next Artifact state</label>
      <select className={INPUT_CLASS} defaultValue="" id={`artifact-state-${artifactJobId}`} name="nextState" required>
        <option disabled value="">Next state</option>
        {transitions.map((transition) => (
          <option key={transition} value={transition}>{transition.replaceAll("_", " ")}</option>
        ))}
      </select>
      <label className="sr-only" htmlFor={`artifact-reason-${artifactJobId}`}>Reason</label>
      <input className={INPUT_CLASS} id={`artifact-reason-${artifactJobId}`} maxLength={500} minLength={3} name="reason" placeholder="Reason or production note" required />
      <button className={BUTTON_CLASS} disabled={submitting} type="submit">Update</button>
      <span aria-live="polite" className="text-xs text-black/42 sm:col-span-3">{message}</span>
    </form>
  );
}

export function OperatorAnnouncementCreateAction() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await actionRequest("/api/ops/announcements", {
        body: String(data.get("body") ?? ""),
        targetKind: String(data.get("targetKind") ?? "all_active_members"),
        title: String(data.get("title") ?? ""),
      });
      form.reset();
      setMessage("Draft announcement created.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The announcement could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="grid gap-4 border-y border-black/25 py-6" onSubmit={submit}>
      <div>
        <p className="text-[0.62rem] font-medium uppercase tracking-[0.16em] text-black/42">Operator action</p>
        <h2 className="ui-heading mt-2 text-2xl font-semibold">Create a draft</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,0.4fr)]">
        <label className="grid gap-2 text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/50">
          Title
          <input className={INPUT_CLASS} maxLength={120} minLength={3} name="title" required />
        </label>
        <label className="grid gap-2 text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/50">
          Audience
          <select className={INPUT_CLASS} defaultValue="all_active_members" name="targetKind">
            <option value="all_active_members">All active members</option>
          </select>
        </label>
      </div>
      <label className="grid gap-2 text-[0.62rem] font-medium uppercase tracking-[0.14em] text-black/50">
        Announcement
        <textarea className={`${INPUT_CLASS} min-h-32 resize-y normal-case tracking-normal`} maxLength={4000} minLength={3} name="body" required />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span aria-live="polite" className="text-xs text-black/42">{message}</span>
        <button className={BUTTON_CLASS} disabled={submitting} type="submit">{submitting ? "Creating" : "Create draft"}</button>
      </div>
    </form>
  );
}

export function OperatorAnnouncementPublishAction({ announcementId }: { announcementId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function publish() {
    setSubmitting(true);
    setMessage("");
    try {
      await actionRequest(`/api/ops/announcements/${announcementId}/publish`, {});
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
      <button className={BUTTON_CLASS} disabled={submitting} onClick={publish} type="button">{submitting ? "Publishing" : "Publish"}</button>
    </div>
  );
}
