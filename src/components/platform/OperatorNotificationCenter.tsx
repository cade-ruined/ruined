"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import OperatorPageFrame from "@/components/platform/OperatorPageFrame";
import OperatorMessagesTabs from "@/components/platform/OperatorMessagesTabs";
import OperatorDialog from "@/components/platform/OperatorDialog";
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
  const [composing, setComposing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState("");
  const [deliveryStatus, setDeliveryStatus] = useState("all");
  const pendingRef = useRef(false);
  const requestKey = useRef("");
  const requestBody = useRef("");
  const formRef = useRef<HTMLFormElement>(null);
  const [review, setReview] = useState<{ draft: NotificationDraft; audience: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    function readLocation() {
      if (window.location.hash === "#write-notification") setComposing(true);
    }
    readLocation();
    window.addEventListener("hashchange", readLocation);
    return () => window.removeEventListener("hashchange", readLocation);
  }, []);
  function openComposer() {
    setComposing(true);
    setMessage("");
    setFailed(false);
    window.history.replaceState(window.history.state, "", "#write-notification");
  }
  function closeComposer() {
    if (pendingRef.current) return;
    setComposing(false);
    setReview(null);
    setDirty(false);
    window.history.replaceState(window.history.state, "", "#notification-history");
  }
  const stats = useMemo(() => ({
    delivered: data.history.filter((item) => item.status === "delivered").length,
    read: data.history.filter((item) => opsNotificationReadState(item.status, item.readAt) === "read").length,
    recent: data.history.length,
  }), [data.history]);
  const history = data.history.filter((item) =>
    (deliveryStatus === "all" || item.status === deliveryStatus)
    && `${item.title} ${item.memberName} ${item.type}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  function reviewNotification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
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
    if (!review || pendingRef.current) return;
    pendingRef.current = true;
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
      setDirty(false);
      setComposing(false);
      window.history.replaceState(window.history.state, "", "#notification-history");
      setMessage(`Saved in the app for ${result.dispatch.recipientCount} member${result.dispatch.recipientCount === 1 ? "" : "s"}. No email or text message was sent.`);
      router.refresh();
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : "Delivery could not be confirmed. Your message is still here.");
    } finally {
      pendingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <OperatorPageFrame title="Messages">
      <OperatorMessagesTabs active="alerts" />
      <header className="operator-record-header mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="operator-page-heading">Notifications</h2><p className="mt-1 text-xs text-black/60">Visible in the app. No email or text is sent.</p></div>
        <button className={OPERATOR_PRIMARY_ACTION_CLASS} id="open-write-notification" onClick={openComposer} type="button">Write notification</button>
      </header>
      {preview ? <p className="mb-4 text-sm text-black/60" role="status">Preview — review is available; notifications are not sent.</p> : null}
      {!composing && message ? <p role={failed ? "alert" : "status"} className="mt-4 text-sm">{message}</p> : null}

      <section aria-labelledby="notification-history-heading" id="notification-history">
        <h3 className="sr-only" id="notification-history-heading">Recent delivery</h3>
        <div className="mb-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <label className={OPERATOR_LABEL_CLASS}><span className="operator-compact-label">Find a notification</span><input className={OPERATOR_FIELD_CLASS} onChange={(event) => setQuery(event.target.value)} placeholder="Search message or member" type="search" value={query} /></label>
          <label className={OPERATOR_LABEL_CLASS}><span className="operator-compact-label">Status</span><select className={OPERATOR_FIELD_CLASS} onChange={(event) => setDeliveryStatus(event.target.value)} value={deliveryStatus}><option value="all">All delivery</option>{[...new Set(data.history.map((item) => item.status))].sort().map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
        </div>
        <div className="mb-3 flex flex-wrap justify-between gap-2 text-xs text-black/55"><p aria-label="Notification snapshot">{stats.recent} recent · {stats.delivered} delivered · {stats.read} read</p>{query || deliveryStatus !== "all" ? <p aria-live="polite">{history.length} match</p> : null}</div>
        <div className="grid gap-2">
          {history.map((item) => (
            <article className="operator-bento-card grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_auto] sm:items-center" key={item.notificationId}>
              <div><strong className="ui-heading text-sm font-semibold">{item.title}</strong><p className="mt-1 text-xs text-black/55">{item.type} · {formatDate(item.statusAt)}</p></div>
              <Link className="inline-flex min-h-11 items-center break-words text-sm underline decoration-black/20 underline-offset-4" href={`/ops/members/${item.memberId}`}>{item.memberName}</Link>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`w-fit rounded-[4px] px-2 py-1 text-xs ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
                {opsNotificationReadState(item.status, item.readAt) ? <span className="text-xs text-black/55">{opsNotificationReadState(item.status, item.readAt)}</span> : null}
              </div>
            </article>
          ))}
          {history.length === 0 ? <p className="operator-bento-card text-sm text-black/60">{data.history.length ? "No matching notifications. Try another message, member, or status." : "No notifications yet. Choose Write notification when there is something to share."}</p> : null}
        </div>
      </section>

      {composing ? <OperatorDialog open title={review ? "Review notification" : "Write notification"} onClose={closeComposer} pending={submitting} returnFocusId="open-write-notification">
      <section id="write-notification" data-operator-dirty={dirty || Boolean(review)} data-operator-pending={submitting}>
      <p className="mb-5 text-sm text-black/60">{review ? "Check the message and audience before sending." : "Choose the audience, write your message, then review. No email or text is sent."}</p>
      <form hidden={Boolean(review)} onSubmit={reviewNotification} onChange={() => { setReview(null); setDirty(true); }} ref={formRef}>
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
      </OperatorDialog> : null}
    </OperatorPageFrame>
  );
}
