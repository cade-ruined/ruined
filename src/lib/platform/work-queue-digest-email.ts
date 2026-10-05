import type { OpsWorkQueue } from "@/lib/platform/ops-model";
import { WORK_QUEUE_DIGEST_SITE, type WorkQueueDigestSlot } from "./work-queue-digest-model";

const MAX_ITEMS = 12;
const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const cleanText = (value: string, maximum = 200) => value.replace(/[\r\n\t]+/g, " ").trim().slice(0, maximum);
const count = (value: number) => value >= 200 ? "200+" : String(Math.max(0, value));

/** The input allowlist deliberately excludes note bodies, contacts and billing. */
export function createWorkQueueDigestEmail(input: { queue: OpsWorkQueue; slot: WorkQueueDigestSlot; generatedAt: string }) {
  const { queue, slot } = input;
  const time = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: slot.timeZone, timeZoneName: "short" });
  const formatTime = (date: Date) => time.format(date).replace("GMT-7", "MST");
  const scheduled = formatTime(new Date(slot.scheduledFor));
  const generated = formatTime(new Date(input.generatedAt));
  const workUrl = `${WORK_QUEUE_DIGEST_SITE}/ops/work`;
  const summary = `${count(queue.totals.tasks)} tasks · ${count(queue.totals.artifacts)} Artifacts · ${count(queue.totals.failures)} failed actions`;
  const items = queue.items.slice(0, MAX_ITEMS).map((item) => {
    const title = cleanText(item.label);
    const member = item.memberName ? cleanText(item.memberName, 100) : "System work";
    const state = cleanText(item.state.replaceAll("_", " "), 40);
    const date = item.dueAt && Number.isFinite(Date.parse(item.dueAt)) ? formatTime(new Date(item.dueAt)) : null;
    const due = date ? `${item.kind === "workflow_failure" ? "Updated" : "Due"} ${date}` : "No due date";
    const href = item.kind === "artifact"
      ? `${WORK_QUEUE_DIGEST_SITE}/ops/artifacts?focus=${encodeURIComponent(item.workId)}#artifact-${encodeURIComponent(item.workId)}`
      : item.memberId ? `${WORK_QUEUE_DIGEST_SITE}/ops/members/${encodeURIComponent(item.memberId)}${item.kind === "task" && item.taskType === "registration.billing_review" ? "#membership" : "#record"}` : workUrl;
    return { title, member, state, due, href };
  });
  const remainder = queue.items.length > MAX_ITEMS ? `Showing the first ${MAX_ITEMS} prioritized items. Open the work queue for the rest.` : "";
  const bounded = Object.values(queue.totals).some((value) => value >= 200) ? "200+ indicates a category reached the current queue limit." : "";
  const empty = "No open tasks, Artifact jobs, or failed actions are waiting in the work queue.";
  const rows = items.map((item) => `<tr><td style="padding:20px 0;border-top:1px solid #C8C3BA"><a href="${escapeHtml(item.href)}" style="font-size:16px;font-weight:600;line-height:1.5;color:#222;text-decoration:none">${escapeHtml(item.title)}</a><p style="margin:6px 0 0;font-size:13px;line-height:1.6;color:#595750">${escapeHtml(item.member)} · ${escapeHtml(item.state)}<br>${escapeHtml(item.due)}</p></td></tr>`).join("");
  return {
    subject: `Ruined work queue · ${scheduled}`,
    text: ["RUINED / OPERATOR WORK", scheduled, "", summary, "", ...(items.length ? items.flatMap((item) => [item.title, `${item.member} · ${item.state} · ${item.due}`, item.href, ""]) : [empty, ""]), remainder, bounded, `Open work queue: ${workUrl}`, "", `Snapshot prepared ${generated}. Work may have changed since this email was prepared.`, "Administrator access is required to open these records."].filter((value) => value !== undefined).join("\n"),
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#E5E0D5;color:#222;font-family:Arial,Helvetica,sans-serif"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:36px 24px"><table role="presentation" style="width:100%;max-width:580px;margin:0 auto;border-collapse:collapse"><tr><td style="padding-bottom:38px"><img src="${WORK_QUEUE_DIGEST_SITE}/ruined-wordmark-email.png" width="150" alt="Ruined" style="display:block;max-width:100%;height:auto"></td></tr><tr><td><p style="margin:0 0 10px;font-size:12px;color:#595750">OPERATOR WORK · ${escapeHtml(scheduled)}</p><h1 style="margin:0;font-size:30px;line-height:1.15;letter-spacing:-1px;font-weight:600">Work queue</h1><p style="margin:14px 0 28px;font-size:14px;line-height:1.6">${escapeHtml(summary)}</p></td></tr>${items.length ? rows : `<tr><td style="padding:24px 0;border-top:1px solid #C8C3BA;font-size:15px;line-height:1.7">${empty}</td></tr>`}<tr><td style="padding-top:16px">${remainder || bounded ? `<p style="margin:0 0 20px;font-size:12px;line-height:1.6;color:#595750">${escapeHtml([remainder, bounded].filter(Boolean).join(" "))}</p>` : ""}<a href="${workUrl}" style="display:inline-block;background:#222;color:#E5E0D5;padding:15px 22px;font-size:14px;font-weight:600;text-decoration:none">Open work queue →</a><p style="margin:30px 0 0;font-size:12px;line-height:1.6;color:#595750">Snapshot prepared ${escapeHtml(generated)}.<br>Work may have changed since this email was prepared.<br>Administrator access is required to open these records.</p></td></tr></table></td></tr></table></body></html>`,
  };
}
