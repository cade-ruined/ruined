import Link from "next/link";

import OperatorGoogleCommunicationField from "@/components/platform/OperatorGoogleCommunicationField";
import { OPERATOR_LABEL_TEXT_CLASS, OPERATOR_PRIMARY_ACTION_CLASS } from "@/components/platform/operatorStyles";
import type { OpsCircleCommunicationItem } from "@/lib/platform/ops-model";
import type { OpsExperienceDirectory } from "@/lib/platform/ops-experience-model";

export default function OperatorCircleCommunicationPanel({ circle, communication, directory, preview = false, now = Date.now() }: {
  circle: { id: string; name: string; status: string };
  communication?: OpsCircleCommunicationItem;
  directory: OpsExperienceDirectory | null;
  preview?: boolean;
  now?: number;
}) {
  const current = circle.status === "active" || circle.status === "forming";
  const chat = communication?.id === circle.id ? communication : undefined;
  const circleDirectory = `/ops/experiences?circleId=${encodeURIComponent(circle.id)}`;
  const canSchedule = current && directory?.canCreate && directory.circles.some((item) => item.id === circle.id);
  const meetings = (directory?.experiences ?? []).filter((item) => item.circleId === circle.id);
  const upcoming = meetings.filter((item) => ["draft", "published"].includes(item.state) && Date.parse(item.endsAt ?? item.startsAt) >= now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const visible = upcoming.length ? upcoming.slice(0, 3) : meetings.filter((item) => !["archived", "cancelled"].includes(item.state))
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)).slice(0, 1);

  return <div className="grid min-w-0 gap-5 lg:grid-cols-2">
    <section aria-label={`${circle.name} chat`} className="min-w-0">
      <h3 className={`${OPERATOR_LABEL_TEXT_CLASS} mb-3`}>Circle chat</h3>
      {chat ? <OperatorGoogleCommunicationField
        key={`chat-${circle.id}`} configured={chat.googleCommunicationsConfigured} editable={current} inline
        entityId={circle.id} entityType="circle" initialUrl={chat.chatUrl} kind="chat" preview={preview}
      /> : <p className="rounded-[4px] bg-black/[0.035] p-4 text-sm text-black/65" role="status">The saved chat link could not be loaded. Refresh this Circle before making changes.</p>}
    </section>
    <section aria-label={`${circle.name} meetings`} className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className={OPERATOR_LABEL_TEXT_CLASS}>Meetings</h3>
        {canSchedule ? <Link className={OPERATOR_PRIMARY_ACTION_CLASS} href={`${circleDirectory}#new-experience`}>Schedule a meeting</Link> : null}
      </div>
      <p className="mb-4 text-sm leading-relaxed text-black/65">Choose a date for {circle.name}, save a draft, then review and publish. Use an existing Meet link or the Google invitation controls on the meeting.</p>
      {!directory ? <p role="status" className="mb-3 text-sm text-[var(--color-poster)]">Meetings could not be loaded. Open Experiences to retry.</p> : visible.length ? <>
        <p className="mb-2 text-xs font-semibold text-black/55">{upcoming.length ? "Upcoming & drafts" : "Most recent"}</p>
        <ul className="grid gap-3">{visible.map((meeting) => <li key={meeting.experienceId} className="rounded-[4px] bg-black/[0.035] p-4">
          <p className="text-xs text-black/55">{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Denver" }).format(new Date(meeting.startsAt))} MT · {meeting.state === "draft" ? "Draft — not published" : meeting.state === "published" ? "Published" : "Completed"}</p>
          <h4 className="mt-1 text-base font-semibold">{meeting.title}</h4>
          <p className="mt-2 text-sm text-black/60">{meeting.meetingUrl ? "Meeting link saved" : "No meeting link yet"}</p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold">
            <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href={`/ops/experiences/${encodeURIComponent(meeting.experienceId)}#meeting-setup`}>{meeting.meetingUrl ? "Manage meeting link" : "Set meeting link"}</Link>
            <Link className="inline-flex min-h-11 items-center underline underline-offset-4" href={`/ops/experiences/${encodeURIComponent(meeting.experienceId)}#experience-calendar`}>Review invitations</Link>
          </div>
        </li>)}</ul>
      </> : <p className="rounded-[4px] bg-black/[0.035] p-4 text-sm text-black/65">No meetings scheduled for {circle.name} yet.</p>}
      <Link className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4" href={directory ? circleDirectory : "/ops/experiences"}>{directory ? "View all Circle meetings →" : "Open Experiences →"}</Link>
      {!current ? <p className="mt-2 text-xs text-black/55">This Circle is closed. Existing meetings remain available for review.</p> : null}
    </section>
  </div>;
}
