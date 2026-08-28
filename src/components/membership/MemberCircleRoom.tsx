import Link from "next/link";

import MemberPageHeader, {
  MemberEmptyRoom,
} from "@/components/membership/MemberPageHeader";
import type {
  MemberExperienceSummary,
  MemberCircleSnapshot,
  PrivacySafePersonSummary,
} from "@/lib/membership/model";

function formatMoment(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: timezone,
    timeStyle: "short",
  }).format(new Date(value));
}

function ContactLine({ person }: { person: PrivacySafePersonSummary }) {
  if (!person.email && !person.phone) {
    return (
      <p className="mt-4 font-[var(--font-body)] text-sm leading-relaxed text-white/42">
        Contact stays private until this person chooses to share it with you.
      </p>
    );
  }
  return (
    <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 font-[var(--font-body)] text-sm text-white/65">
      {person.email ? <a href={`mailto:${person.email}`}>{person.email}</a> : null}
      {person.phone ? <a href={`tel:${person.phone}`}>{person.phone}</a> : null}
    </div>
  );
}

function MeetingRow({ meeting }: { meeting: MemberExperienceSummary }) {
  return (
    <li className="grid gap-4 border-b border-black/15 py-7 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-start sm:gap-8">
      <time className="font-[var(--font-body)] text-[0.64rem] font-medium uppercase tracking-[0.14em] text-black/42">
        {formatMoment(meeting.startsAt, meeting.timezone)}
      </time>
      <div>
        <h3 className="font-[var(--font-display)] text-3xl leading-none tracking-[-0.025em]">
          {meeting.title}
        </h3>
        <p className="mt-3 max-w-2xl font-[var(--font-body)] text-sm leading-relaxed text-black/52">
          {meeting.summary ?? "The next Circle room."}
        </p>
        {meeting.locationLabel ? (
          <p className="mt-3 font-[var(--font-body)] text-xs uppercase tracking-[0.12em] text-black/38">
            {meeting.locationLabel}
          </p>
        ) : null}
      </div>
      <span className="font-[var(--font-body)] text-[0.6rem] uppercase tracking-[0.13em] text-[var(--color-poster)]">
        {meeting.registrationState.replaceAll("_", " ")}
      </span>
    </li>
  );
}

export default function MemberCircleRoom({ circle }: { circle: MemberCircleSnapshot }) {
  const futureMeetings = circle.meetings
    .filter((meeting) => new Date(meeting.endsAt ?? meeting.startsAt).getTime() >= Date.now())
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  return (
    <main>
      <MemberPageHeader
        eyebrow="Ruined Membership / Circle"
        imageIntent="A circle of chairs before anyone arrives. Honest materials. Morning side light."
        imageSequence="02"
        note="the people closest to the work"
        summary={
          circle.circle
            ? `${circle.circle.name} is your immediate room. ${circle.block ? `${circle.block.name} is the wider body around it.` : "Its wider Block will appear when it is formed."}`
            : "Ruined forms Circles deliberately. Your room and its people will appear here when the assignment is active."
        }
        title={circle.circle?.name ?? "Being formed."}
      />

      {!circle.circle ? (
        <section className="mt-16">
          <MemberEmptyRoom
            body="You may begin the administrative side of membership while Ruined forms your Circle. Foundations can begin after onboarding, but it cannot be completed until an active Circle is in place."
            title="Your Circle has not been assigned yet."
          />
        </section>
      ) : (
        <>
          <section className="mt-16 grid bg-[#080605] text-[var(--color-bone)] lg:grid-cols-2">
            <div className="px-6 py-10 sm:px-10 sm:py-14 lg:px-14 lg:py-16">
              <p className="font-[var(--font-body)] text-[0.64rem] font-medium uppercase tracking-[0.16em] text-[var(--color-poster)]">
                Accountability
              </p>
              {circle.accountabilityPartner ? (
                <>
                  <h2 className="mt-6 font-[var(--font-display)] text-5xl leading-[0.9] tracking-[-0.04em] sm:text-6xl">
                    {circle.accountabilityPartner.displayName}
                  </h2>
                  {circle.accountabilityPartner.buildingNow ? (
                    <p className="mt-6 max-w-xl font-[var(--font-body)] text-base leading-relaxed text-white/52">
                      Building now: {circle.accountabilityPartner.buildingNow}
                    </p>
                  ) : null}
                  <ContactLine person={circle.accountabilityPartner} />
                </>
              ) : (
                <>
                  <h2 className="mt-6 font-[var(--font-display)] text-5xl leading-[0.9] tracking-[-0.04em] sm:text-6xl">
                    Not paired yet.
                  </h2>
                  <p className="mt-6 max-w-xl font-[var(--font-body)] text-base leading-relaxed text-white/45">
                    The pairing will appear when a current accountability assignment is made.
                  </p>
                </>
              )}
            </div>
            <div className="border-t border-white/15 px-6 py-10 sm:px-10 sm:py-14 lg:border-l lg:border-t-0 lg:px-14 lg:py-16">
              <p className="font-[var(--font-body)] text-[0.64rem] font-medium uppercase tracking-[0.16em] text-white/38">
                Circle leader
              </p>
              <h2 className="mt-6 font-[var(--font-display)] text-4xl leading-none tracking-[-0.035em]">
                {circle.leader?.displayName ?? "Being assigned"}
              </h2>
              <p className="mt-6 max-w-md font-[var(--font-body)] text-sm leading-relaxed text-white/46">
                The leader holds the room and the rhythm. Private member reflection is never part of the Circle roster.
              </p>
            </div>
          </section>

          <section className="mt-20" aria-labelledby="circle-meetings-title">
            <div className="flex flex-wrap items-end justify-between gap-6 border-b border-black/20 pb-7">
              <div>
                <p className="font-[var(--font-body)] text-[0.64rem] uppercase tracking-[0.16em] text-[var(--color-poster)]">
                  Calendar
                </p>
                <h2 className="mt-4 font-[var(--font-display)] text-5xl leading-none tracking-[-0.04em]" id="circle-meetings-title">
                  Circle rooms.
                </h2>
              </div>
              <Link className="font-[var(--font-body)] text-xs uppercase tracking-[0.14em] text-black/48 underline underline-offset-8" href="/my/experiences">
                All experiences
              </Link>
            </div>
            {futureMeetings.length ? (
              <ol>{futureMeetings.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} />)}</ol>
            ) : (
              <MemberEmptyRoom
                body="When a Circle meeting is published, the date and place will appear here and in Experiences."
                title="No Circle room is scheduled."
              />
            )}
          </section>

          <section className="mt-20 grid gap-14 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)] lg:gap-20">
            <div>
              <div className="border-b border-black/20 pb-7">
                <p className="font-[var(--font-body)] text-[0.64rem] uppercase tracking-[0.16em] text-[var(--color-poster)]">
                  Current roster
                </p>
                <h2 className="mt-4 font-[var(--font-display)] text-5xl leading-none tracking-[-0.04em]">
                  People in the room.
                </h2>
              </div>
              <ol>
                {circle.members.map((person, index) => (
                  <li className="grid gap-4 border-b border-black/15 py-7 sm:grid-cols-[2.5rem_minmax(12rem,0.55fr)_minmax(0,1fr)] sm:gap-7" key={person.id}>
                    <span className="font-[var(--font-body)] text-xs text-black/30">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h3 className="font-[var(--font-display)] text-3xl leading-none tracking-[-0.025em]">
                        {person.displayName}{person.isSelf ? " / You" : ""}
                      </h3>
                      {person.location ? <p className="mt-3 font-[var(--font-body)] text-xs uppercase tracking-[0.12em] text-black/38">{person.location}</p> : null}
                    </div>
                    <div>
                      {person.buildingNow ? <p className="font-[var(--font-body)] text-sm leading-relaxed text-black/55">{person.buildingNow}</p> : null}
                      {person.bio ? <p className="mt-3 font-[var(--font-body)] text-sm leading-relaxed text-black/42">{person.bio}</p> : null}
                      {person.email || person.phone ? (
                        <p className="mt-4 flex flex-wrap gap-x-5 font-[var(--font-body)] text-xs text-black/46">
                          {person.email ? <a href={`mailto:${person.email}`}>{person.email}</a> : null}
                          {person.phone ? <a href={`tel:${person.phone}`}>{person.phone}</a> : null}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-5 max-w-xl font-[var(--font-body)] text-xs leading-relaxed text-black/40">
                Names are part of the roster. Location, biography, current work, email, and phone appear only when each member chooses to share them.
              </p>
            </div>

            <aside>
              <div className="border-b border-black/20 pb-7">
                <p className="font-[var(--font-body)] text-[0.64rem] uppercase tracking-[0.16em] text-[var(--color-poster)]">
                  Held close
                </p>
                <h2 className="mt-4 font-[var(--font-display)] text-4xl leading-none tracking-[-0.035em]">
                  Circle resources.
                </h2>
              </div>
              {circle.resources.length ? (
                <ol>
                  {circle.resources.map((resource) => (
                    <li className="border-b border-black/15 py-6" key={resource.id}>
                      <Link className="group block" href={resource.href}>
                        <h3 className="font-[var(--font-display)] text-2xl leading-none tracking-[-0.02em]">{resource.label}</h3>
                        {resource.description ? <p className="mt-3 font-[var(--font-body)] text-sm leading-relaxed text-black/48">{resource.description}</p> : null}
                        <span className="mt-4 inline-block font-[var(--font-body)] text-xs uppercase tracking-[0.13em] text-black/38 group-hover:text-black">Open →</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="border-b border-black/15 py-8 font-[var(--font-body)] text-sm leading-relaxed text-black/45">
                  No Circle-specific material has been shared yet.
                </p>
              )}
            </aside>
          </section>
        </>
      )}
    </main>
  );
}
