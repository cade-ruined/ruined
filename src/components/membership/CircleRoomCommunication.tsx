import Link from "next/link";

import type { MemberExperienceSummary } from "@/lib/membership/model";

type CircleRoomCommunicationProps = {
  chat: {
    href: string | null;
    state: "ready" | "unavailable";
  };
  meeting: MemberExperienceSummary | null;
};

function formatMoment(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "long",
    timeZone: timezone,
    weekday: "long",
  }).format(new Date(value));
}

function meetingStamp(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    timeZone: timezone,
  }).formatToParts(new Date(value));

  return {
    day: parts.find((part) => part.type === "day")?.value ?? "--",
    month: parts.find((part) => part.type === "month")?.value ?? "---",
  };
}

const cardFocus =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#15120f]";

function ChatCard({ chat }: Pick<CircleRoomCommunicationProps, "chat">) {
  const ready = chat.state === "ready" && Boolean(chat.href);
  const contents = (
    <>
      <div>
        <p className="[font-family:var(--font-cadehandy2)] text-[1.35rem] leading-none text-black/58">
          Between gatherings
        </p>
        <h3 className="ui-heading mt-3 text-[clamp(2rem,4.5vw,3.8rem)] font-black uppercase leading-[0.82] tracking-[-0.055em] text-[#15120f]">
          Circle Chat
        </h3>
      </div>
      <div className="mt-auto pt-8">
        <p className="max-w-[30rem] font-[var(--font-body)] text-sm font-semibold leading-relaxed text-black/62">
          The ongoing room for questions, notes, and the work between meetings.
        </p>
        <span className="mt-6 inline-flex min-h-11 items-center font-[var(--font-body)] text-[0.68rem] font-black uppercase tracking-[0.045em] text-black/70 transition-transform group-hover:translate-x-1 motion-reduce:transition-none">
          {ready ? "Open Google Chat ↗" : "Being connected"}
        </span>
      </div>
    </>
  );

  const cardClassName =
    "group flex min-h-[17rem] flex-col rounded-[4px] bg-[#B7CBDD] p-5 shadow-[7px_8px_0_#15120f] sm:p-6";

  return ready && chat.href ? (
    <Link
      aria-label="Open this Circle in Google Chat"
      className={`${cardClassName} transition-[box-shadow,transform] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[4px_5px_0_#15120f] motion-reduce:transition-none ${cardFocus}`}
      data-circle-chat-card
      data-state="ready"
      href={chat.href}
      rel="noreferrer"
      target="_blank"
    >
      {contents}
    </Link>
  ) : (
    <article className={cardClassName} data-circle-chat-card data-state="unavailable">
      {contents}
    </article>
  );
}

function MeetCard({ meeting }: Pick<CircleRoomCommunicationProps, "meeting">) {
  if (!meeting) {
    return (
      <article
        className="flex min-h-[17rem] flex-col rounded-[4px] bg-[#3B5D4F] p-5 text-[var(--color-bone)] shadow-[7px_8px_0_#15120f] sm:p-6"
        data-circle-meet-card
        data-state="unscheduled"
      >
        <p className="[font-family:var(--font-cadehandy2)] text-[1.35rem] leading-none text-[#FFCA2C]">
          Next gathering
        </p>
        <h3 className="ui-heading mt-3 max-w-[10ch] text-[clamp(2rem,4.5vw,3.8rem)] font-black uppercase leading-[0.82] tracking-[-0.055em]">
          No date yet
        </h3>
        <p className="mt-auto max-w-[30rem] pt-8 font-[var(--font-body)] text-sm font-semibold leading-relaxed text-white/64">
          Your next Circle gathering will appear here when the room is scheduled.
        </p>
      </article>
    );
  }

  const stamp = meetingStamp(meeting.startsAt, meeting.timezone);
  const actionHref = meeting.meetingUrl ?? meeting.detailHref;
  const actionLabel = meeting.meetingUrl ? "Join Google Meet ↗" : "View gathering →";

  return (
    <article
      className="flex min-h-[17rem] flex-col rounded-[4px] bg-[#3B5D4F] p-5 text-[var(--color-bone)] shadow-[7px_8px_0_#15120f] sm:p-6"
      data-circle-meet-card
      data-state={meeting.meetingUrl ? "ready" : "scheduled"}
    >
      <div className="grid grid-cols-[4.1rem_minmax(0,1fr)] gap-4">
        <time aria-label={formatMoment(meeting.startsAt, meeting.timezone)} dateTime={meeting.startsAt}>
          <span aria-hidden="true" className="block font-[var(--font-body)] text-[0.62rem] font-black uppercase tracking-[0.045em] text-white/55">
            {stamp.month}
          </span>
          <span aria-hidden="true" className="ui-heading mt-1 block text-5xl font-black leading-none tracking-[-0.055em] text-[#FFCA2C]">
            {stamp.day}
          </span>
        </time>
        <div className="min-w-0">
          <p className="[font-family:var(--font-cadehandy2)] text-[1.35rem] leading-none text-[#FFCA2C]">
            Next gathering
          </p>
          <h3 className="ui-heading mt-3 text-[clamp(1.75rem,4vw,3.15rem)] font-black uppercase leading-[0.84] tracking-[-0.05em]">
            {meeting.title}
          </h3>
        </div>
      </div>
      <div className="mt-auto pt-8">
        <p className="font-[var(--font-body)] text-xs font-semibold leading-relaxed text-white/68">
          {formatMoment(meeting.startsAt, meeting.timezone)}
          {meeting.locationLabel ? ` · ${meeting.locationLabel}` : ""}
        </p>
        <Link
          aria-label={`${actionLabel.replace(" ↗", "").replace(" →", "")}: ${meeting.title}`}
          className={`mt-4 inline-flex min-h-11 items-center font-[var(--font-body)] text-[0.68rem] font-black uppercase tracking-[0.045em] text-white transition-transform hover:translate-x-1 motion-reduce:transition-none ${cardFocus}`}
          href={actionHref}
          rel={meeting.meetingUrl ? "noreferrer" : undefined}
          target={meeting.meetingUrl ? "_blank" : undefined}
        >
          {actionLabel}
        </Link>
      </div>
    </article>
  );
}

export default function CircleRoomCommunication({
  chat,
  meeting,
}: CircleRoomCommunicationProps) {
  return (
    <section aria-labelledby="circle-room-title" className="mt-12 sm:mt-14" data-circle-communications>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="ui-heading text-[clamp(2rem,4vw,3.5rem)] font-black uppercase leading-[0.84] tracking-[-0.05em] text-[#191613]" id="circle-room-title">
          The room
        </h2>
        <Link
          className="inline-flex min-h-11 items-center font-[var(--font-body)] text-xs font-bold uppercase tracking-[0.045em] text-black/58 transition-colors hover:text-[var(--color-poster)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-poster)]"
          href="/my/experiences"
        >
          All experiences →
        </Link>
      </div>
      <div className="mt-5 grid gap-7 md:grid-cols-2 md:gap-8">
        <ChatCard chat={chat} />
        <MeetCard meeting={meeting} />
      </div>
    </section>
  );
}
