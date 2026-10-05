import { getPlatformConfiguration } from "@/lib/platform/config";
import { createWorkQueueDigestEmail } from "@/lib/platform/work-queue-digest-email";
import { PREVIEW_OPS_WORK_QUEUE } from "@/lib/platform/ops-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fictional local preview; never reads member records or sends email. */
export function GET(request: Request) {
  if (process.env.NODE_ENV === "production" || getPlatformConfiguration().mode !== "preview") return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const message = createWorkQueueDigestEmail({
    queue: {
      items: [{ kind: "task", taskType: "registration.billing_review", label: "Card saved — billing opening pending", memberId: "preview-01", memberName: "Example member", priority: 50, state: "blocked", dueAt: null, workId: "sample-registration-review", claimedByName: null, claimedByCurrentOperator: false, version: 1 }, ...PREVIEW_OPS_WORK_QUEUE.items],
      totals: { ...PREVIEW_OPS_WORK_QUEUE.totals, tasks: PREVIEW_OPS_WORK_QUEUE.totals.tasks + 1 },
    },
    slot: { localDate: "2026-10-05", localHour: 10, timeZone: "America/Denver", scheduledFor: "2026-10-05T16:00:00.000Z" },
    generatedAt: "2026-10-05T16:00:00.000Z",
  });
  const text = url.searchParams.get("format") === "text";
  const html = message.html.replaceAll("https://members.theruinedproject.com/ruined-wordmark-email.png", "/ruined-wordmark-email.png");
  return new Response(text ? message.text : html, { headers: {
    "Content-Type": text ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
    "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'",
  } });
}
