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

export default function OperatorNotificationCenter({ data }: { data: OpsNotificationCenterData }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const requestKey = useRef("");
  const stats = useMemo(() => ({
    delivered: data.history.filter((item) => item.status === "delivered").length,
    read: data.history.filter((item) => opsNotificationReadState(item.status, item.readAt) === "read").length,
    recent: data.history.length,
  }), [data.history]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    if (!requestKey.current) requestKey.current = createRequestKey();
    const form = event.currentTarget;
    const input = new FormData(form);
    const [targetType, targetId = ""] = String(input.get("audience") ?? "all_active_members").split(":");
    const response = await fetch("/api/ops/notifications", {
      body: JSON.stringify({
        actionLabel: String(input.get("actionLabel") ?? ""),
        actionUrl: String(input.get("actionUrl") ?? ""),
        body: String(input.get("body") ?? ""),
        notificationType: String(input.get("notificationType") ?? "announcement"),
        targetId,
        targetType,
        title: String(input.get("title") ?? ""),
      }),
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
    if (!response.ok) {
      setMessage(typeof result?.error === "string" ? result.error : "The notification could not be sent.");
      setSubmitting(false);
      return;
    }
    form.reset();
    requestKey.current = createRequestKey();
    setMessage(`Sent to ${result?.dispatch?.recipientCount ?? 0} member${result?.dispatch?.recipientCount === 1 ? "" : "s"}.`);
    setSubmitting(false);
    router.refresh();
  }

  return (
    <OperatorPageFrame title="Notifications">
      <section className="grid grid-cols-3 gap-3" aria-label="Notification snapshot">
        <div className="rounded-[4px] bg-black px-4 py-5 text-[var(--color-bone)]"><strong className="block text-3xl">{stats.recent}</strong><span className="text-[0.62rem] uppercase tracking-[0.12em] text-white/55">Recent</span></div>
        <div className="rounded-[4px] bg-[var(--color-verdigris)] px-4 py-5 text-white"><strong className="block text-3xl">{stats.delivered}</strong><span className="text-[0.62rem] uppercase tracking-[0.12em] text-white/70">Delivered</span></div>
        <div className="rounded-[4px] bg-[var(--color-shop)] px-4 py-5"><strong className="block text-3xl">{stats.read}</strong><span className="text-[0.62rem] uppercase tracking-[0.12em] text-black/55">Read</span></div>
      </section>

      <form className="mt-8 grid max-w-5xl gap-5 sm:grid-cols-2" onSubmit={submit}>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Audience</span>
          <select className={OPERATOR_FIELD_CLASS} defaultValue="all_active_members:" name="audience">
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
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Action label</span>
          <input className={OPERATOR_FIELD_CLASS} maxLength={120} name="actionLabel" placeholder="Open Circle" />
        </label>
        <label className={OPERATOR_LABEL_CLASS}>
          <span className={OPERATOR_LABEL_TEXT_CLASS}>Action link</span>
          <input className={OPERATOR_FIELD_CLASS} name="actionUrl" placeholder="/my/circle" />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-4 sm:col-span-2">
          <span aria-live="polite" className="text-sm text-black/52">{message}</span>
          <button className={OPERATOR_PRIMARY_ACTION_CLASS} disabled={submitting} type="submit">{submitting ? "Sending" : "Send notification"}</button>
        </div>
      </form>

      <details className="group mt-8 rounded-[4px] bg-black/[0.025]">
        <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-5 ui-heading text-xl font-semibold marker:hidden">Recent delivery <span className="text-xl transition-transform group-open:rotate-45">＋</span></summary>
        <div className="space-y-px px-3 pb-3 sm:px-5 sm:pb-5">
          {data.history.map((item) => (
            <article className="grid gap-2 bg-[var(--color-bone)] p-4 sm:grid-cols-[1fr_0.7fr_auto] sm:items-center" key={item.notificationId}>
              <div><strong className="ui-heading text-sm font-semibold">{item.title}</strong><p className="mt-1 text-xs text-black/45">{item.type} · {statusLabel(item.status)} {formatDate(item.statusAt)}</p></div>
              <Link className="text-sm underline decoration-black/20 underline-offset-4" href={`/ops/members/${item.memberId}`}>{item.memberName}</Link>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`w-fit px-2 py-1 text-[0.58rem] uppercase tracking-[0.12em] ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
                {opsNotificationReadState(item.status, item.readAt) ? (
                  <span className="text-[0.58rem] uppercase tracking-[0.12em] text-black/42">{opsNotificationReadState(item.status, item.readAt)}</span>
                ) : null}
              </div>
            </article>
          ))}
          {data.history.length === 0 ? <p className="p-5 text-sm text-black/48">No notifications have been sent.</p> : null}
        </div>
      </details>
    </OperatorPageFrame>
  );
}
