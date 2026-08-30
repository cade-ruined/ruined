"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import {
  OPERATOR_BUTTON_CLASS,
  OPERATOR_FIELD_CLASS,
  OPERATOR_LABEL_CLASS,
  OPERATOR_LABEL_TEXT_CLASS,
} from "@/components/platform/operatorStyles";
import type { OpsAnnouncementAudienceOptions } from "@/lib/platform/ops-model";

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
}: {
  audienceOptions: OpsAnnouncementAudienceOptions;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const [targetKind, targetId = ""] = String(data.get("audience") ?? "all_active_members:").split(":");
    try {
      await actionRequest("/api/ops/announcements", {
        body: String(data.get("body") ?? ""),
        targetId,
        targetKind,
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
      <h2 className="ui-heading text-2xl font-semibold">Create a draft</h2>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,0.4fr)]">
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Title</span>
          <input className={OPERATOR_FIELD_CLASS} maxLength={120} minLength={3} name="title" required />
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Audience</span>
          <select className={OPERATOR_FIELD_CLASS} defaultValue="all_active_members:" name="audience">
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
        <textarea className={`${OPERATOR_FIELD_CLASS} min-h-32 resize-y`} maxLength={4000} minLength={3} name="body" required />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span aria-live="polite" className="text-xs text-black/42">{message}</span>
        <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} type="submit">{submitting ? "Creating" : "Create draft"}</button>
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
      <button className={OPERATOR_BUTTON_CLASS} disabled={submitting} onClick={publish} type="button">{submitting ? "Publishing" : "Publish"}</button>
    </div>
  );
}
