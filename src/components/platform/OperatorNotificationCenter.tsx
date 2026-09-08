"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useRef, useState } from "react";

import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import {
  OPERATOR_FIELD_CLASS,
  OPERATOR_LABEL_CLASS,
  OPERATOR_LABEL_TEXT_CLASS,
  OPERATOR_PRIMARY_ACTION_CLASS,
} from "@/components/platform/operatorStyles";
import {
  opsNotificationReadState,
  type OpsNotificationDeliveryStatus,
} from "@/lib/platform/ops-notification-model";
import type { OpsNotificationCenterData } from "@/lib/platform/ops-notification-repository";

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(date);
}

function createRequestKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `notification-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function statusLabel(status: OpsNotificationDeliveryStatus): string {
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

function statusClass(status: OpsNotificationDeliveryStatus): string {
  if (status === "delivered") return "bg-[var(--color-verdigris)] text-white";
  if (status === "failed" || status === "cancelled") return "bg-[var(--color-poster)] text-white";
  if (status === "sent") return "bg-[var(--color-shop)] text-black";
  return "bg-black/8 text-black/55";
}

type NotificationDraft = {
  actionLabel: string; actionUrl: string; body: string; notificationType: string;
  targetId: string; targetType: string; title: string;
};

export default function OperatorNotificationCenter({ data, preview = false }: { data: OpsNotificationCenterData; preview?: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const requestKey = useRef("");
  const requestBody = useRef("");
  const formRef = useRef<HTMLFormElement>(null);
  const [review, setReview] = useState<{ draft: NotificationDraft; audience: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const stats = useMemo(() => ({
    delivered: data.history.filter((item) => item.status === "delivered").length,
    read: data.history.filter((item) => opsNotificationReadState(item.status, item.readAt) === "read").length,
    recent: data.history.length,
  }), [data.history]);

  function reviewNotification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setMessage("");
    setFailed(false);
    const input = new FormData(event.currentTarget);
    const audienceValue = String(input.get("audience") ?? "");
    const [targetType, targetId = ""] = audienceValue.split(":");
    const audience = targetType === "all_active_members" && !targetId ? "All active members"
      : (targetType === "circle" ? data.circles : targetType === "block" ? data.blocks : targetType === "member" ? data.members : []).find((item) => item.id === targetId)?.label;
    if (!audience) { setFailed(true); setMessage("Choose the intended audience before reviewing."); return; }
    setReview({ audience, draft: {
        actionLabel: String(input.get("actionLabel") ?? ""),
        actionUrl: String(input.get("actionUrl") ?? ""),
        body: String(input.get("body") ?? ""),
        notificationType: String(input.get("notificationType") ?? "announcement"),
        targetId,
        targetType,
        title: String(input.get("title") ?? ""),
    } });
  }

  async function sendNotification() {
    if (preview) { setMessage("Preview — notifications are not sent."); return; }
    if (!review || submitting) return;
    setSubmitting(true);
    setFailed(false);
    setMessage("");
    const body = JSON.stringify(review.draft);
    if (!requestKey.current || requestBody.current !== body) requestKey.current = createRequestKey();
    requestBody.current = body;
    try {
      const response = await fetch("/api/ops/notifications", {
        body,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey.current,
        },
        method: "POST",
      });
      const result = (await response.json().catch(() => null)) as {
        dispatch?: { recipientCount?: number };
        error?: unknown;
      } | null;
      if (!response.ok || typeof result?.dispatch?.recipientCount !== "number") {
        throw new Error(typeof result?.error === "string" ? result.error : "Delivery could not be confirmed. Check recent delivery before retrying this message.");
      }
      formRef.current?.reset();
      requestKey.current = "";
      requestBody.current = "";
      setReview(null);
      setMessage(`Saved in the app for ${result.dispatch.recipientCount} member${result.dispatch.recipientCount === 1 ? "" : "s"}. No email or text message was sent.`);
      router.refresh();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Delivery could not be confirmed. Your message is still here.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <OperatorPageFrame title="Notifications">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-black/60">In-app messages, not email or text. Choose an audience and review before sending.</p>
        <a className={OPERATOR_PRIMARY_ACTION_CLASS} href="#write-notification">Write notification</a>
      </header>
      {preview ? <p className="mb-4 text-sm text-black/60" role="status">Preview — review is available; notifications are not sent.</p> : null}
      <section className="grid grid-cols-3 gap-3" aria-label="Notification snapshot">
        <div className="rounded-[4px] bg-black px-4 py-5 text-[var(--color-bone)]"><strong className="block text-3xl">{stats.recent}</strong><span className="text-[0.62rem] uppercase tracking-[0.12em] text-white/55">Recent</span></div>
        <div className="rounded-[4px] bg-[var(--color-verdigris)] px-4 py-5 text-white"><strong className="block text-3xl">{stats.delivered}</strong><span className="text-[0.62rem] uppercase tracking-[0.12em] text-white/70">Delivered</span></div>
        <div className="rounded-[4px] bg-[var(--color-shop)] px-4 py-5"><strong className="block text-3xl">{stats.read}</strong><span className="text-[0.62rem] uppercase tracking-[0.12em] text-black/55">Read</span></div>
      </section>

      <section aria-labelledby="notification-history-heading" className="mt-6" id="notification-history">
        <h2 className="ui-heading mb-4 text-xl font-semibold" id="notification-history-heading">Recent delivery</h2>
        <div className="grid gap-2">
          {data.history.map((item) => (
            <article className="grid gap-2 rounded-[4px] bg-black/[0.025] p-4 sm:grid-cols-[1fr_0.7fr_auto] sm:items-center" key={item.notificationId}>
              <div><strong className="ui-heading text-sm font-semibold">{item.title}</strong><p className="mt-1 text-xs text-black/55">{item.type} · {formatDate(item.statusAt)}</p></div>
              <Link className="text-sm underline decoration-black/20 underline-offset-4" href={`/ops/members/${item.memberId}`}>{item.memberName}</Link>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`w-fit rounded-[4px] px-2 py-1 text-xs ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
                {opsNotificationReadState(item.status, item.readAt) ? <span className="text-xs text-black/55">{opsNotificationReadState(item.status, item.readAt)}</span> : null}
              </div>
            </article>
          ))}
          {data.history.length === 0 ? <p className="text-sm text-black/60">No notifications yet. Write one below when there is something to share.</p> : null}
        </div>
      </section>

      <section className="mt-8 max-w-5xl scroll-mt-32 rounded-[4px] bg-black/[0.025] p-5 sm:p-6" id="write-notification" aria-labelledby="notification-compose-heading">
      <h2 className="ui-heading text-2xl font-semibold" id="notification-compose-heading">Write notification</h2>
      <form className="mt-5" onSubmit={reviewNotification} onChange={() => setReview(null)} ref={formRef}>
      <fieldset className="grid gap-5 sm:grid-cols-2" disabled={submitting}>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Audience</span>
          <select className={OPERATOR_FIELD_CLASS} defaultValue="" name="audience" required>
            <option disabled value="">Choose who should receive this</option>
            <option value="all_active_members:">All active members</option>
            <optgroup label="Circles">
              {data.circles.map((circle) => <option key={circle.id} value={`circle:${circle.id}`}>{circle.label}</option>)}
            </optgroup>
            <optgroup label="Blocks">
              {data.blocks.map((block) => <option key={block.id} value={`block:${block.id}`}>{block.label}</option>)}
            </optgroup>
            <optgroup label="One member">
              {data.members.map((member) => <option key={member.id} value={`member:${member.id}`}>{member.label}</option>)}
            </optgroup>
          </select>
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Type</span>
          <select className={OPERATOR_FIELD_CLASS} defaultValue="announcement" name="notificationType">
            <option value="announcement">Announcement</option>
            <option value="reminder">Reminder</option>
            <option value="membership">Membership</option>
            <option value="circle">Circle</option>
            <option value="foundations">Foundations</option>
            <option value="artifact">Artifact</option>
            <option value="system">System</option>
          </select>
        </label>
        <label className={`${OPERATOR_LABEL_CLASS} sm:col-span-2`}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Title</span>
          <input className={OPERATOR_FIELD_CLASS} maxLength={200} minLength={2} name="title" required />
        </label>
        <label className={`${OPERATOR_LABEL_CLASS} sm:col-span-2`}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Message</span>
          <textarea className={`${OPERATOR_FIELD_CLASS} min-h-32 resize-y`} maxLength={10000} minLength={2} name="body" required />
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Button text · optional</span>
          <input className={OPERATOR_FIELD_CLASS} maxLength={120} name="actionLabel" placeholder="Open Circle" />
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Member-app link · optional</span>
          <input className={OPERATOR_FIELD_CLASS} name="actionUrl" placeholder="/my/circle" />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-4 sm:col-span-2">
          <p className="text-sm text-black/60">Review the exact message and audience next. Nothing is sent yet.</p>
          <button className={OPERATOR_PRIMARY_ACTION_CLASS} disabled={submitting} type="submit">Review notification</button>
        </div>
      </fieldset>
      </form>
      {review ? <section aria-label="Review notification before sending" className="mt-5 rounded-[4px] bg-[var(--color-highlight)]/35 p-4">
        <p className="text-sm">Send to <strong>{review.audience}</strong></p>
        <h3 className="ui-heading mt-3 break-words text-xl font-semibold">{review.draft.title}</h3>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{review.draft.body}</p>
        {review.draft.actionUrl ? <p className="mt-3 break-all text-xs">{review.draft.actionLabel || "Open"} · {review.draft.actionUrl}</p> : null}
        <p className="mt-3 text-sm text-black/65">This sends immediately to the selected audience. It cannot be retracted here.</p>
        <div className="mt-4 flex flex-wrap gap-4"><button className={OPERATOR_PRIMARY_ACTION_CLASS} disabled={preview || submitting} onClick={sendNotification} type="button">{submitting ? "Sending" : "Send notification"}</button><button className="min-h-11 text-sm underline underline-offset-4" disabled={submitting} onClick={() => setReview(null)} type="button">Back to editing</button></div>
      </section> : null}
      <div role={failed ? "alert" : "status"} className={`mt-4 text-sm ${failed ? "text-[var(--color-poster)]" : "text-black/60"}`}><p>{message}</p>{failed ? <button className="mt-2 min-h-11 underline underline-offset-4" onClick={() => router.refresh()} type="button">Refresh recent delivery</button> : null}</div>
      </section>
    </OperatorPageFrame>
  );
}
