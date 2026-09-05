import Link from "next/link";

import CircleMemberCluster from "@/components/membership/CircleMemberCluster";
import CircleRoomCommunication from "@/components/membership/CircleRoomCommunication";
import type { MemberCircleSnapshot } from "@/lib/membership/model";

export default function MemberCircleRoom({ circle }: { circle: MemberCircleSnapshot }) {
  const futureMeetings = circle.meetings
    .filter((meeting) => new Date(meeting.endsAt ?? meeting.startsAt).getTime() >= Date.now())
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const visibleMembers = circle.members.slice(0, 10);

  return (
    <main className="member-profile-dossier mx-auto max-w-[82rem] pb-20 pt-2 sm:pb-24 sm:pt-4" data-member-circle-room>
      {!circle.circle ? (
        <section className="mx-auto flex min-h-[58vh] max-w-4xl flex-col justify-center py-12" data-circle-unassigned>
          <p className="[font-family:var(--font-cadehandy2)] text-[1.65rem] leading-none text-[var(--color-poster)] sm:text-[1.9rem]">
            Your Circle
          </p>
          <h1 className="ui-heading mt-3 max-w-[12ch] text-[clamp(3.2rem,10vw,7.5rem)] font-black uppercase leading-[0.82] tracking-[-0.06em] text-[#15120f]">
            The room is being formed.
          </h1>
          <p className="mt-7 max-w-xl font-[var(--font-body)] text-base leading-relaxed text-black/58">
            You can continue Foundations now. Ruined will place you into a Circle before Foundations can be completed.
          </p>
          <Link className="mt-8 w-fit rounded-[4px] bg-[var(--color-faded)] px-5 py-4 font-[var(--font-body)] text-xs font-bold uppercase tracking-[0.04em] text-[var(--color-bone)] shadow-[6px_7px_0_var(--color-poster)] transition-transform active:translate-x-[2px] active:translate-y-[2px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-poster)]" href="/my/foundations">
            Continue Foundations →
          </Link>
        </section>
      ) : (
        <>
          <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="[font-family:var(--font-cadehandy2)] text-[1.55rem] leading-none text-[var(--color-poster)] sm:text-[1.8rem]">
                Your Circle
              </p>
              <h1 className="ui-heading mt-2 break-words text-[clamp(3.2rem,9vw,7.75rem)] font-black uppercase leading-[0.8] tracking-[-0.065em] text-[#15120f]">
                {circle.circle.name}
              </h1>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 font-[var(--font-body)] text-[0.68rem] font-bold uppercase tracking-[0.035em] text-black/48">
                <span>{visibleMembers.length} {visibleMembers.length === 1 ? "member" : "members"}</span>
                <span>{circle.circle.status.replaceAll("_", " ")}</span>
                {circle.block ? <span>{circle.block.name}</span> : null}
              </div>
            </div>
            {circle.shaper ? (
              <div className="pb-1 sm:max-w-[15rem] sm:text-right">
                <p className="[font-family:var(--font-cadehandy2)] text-[1.25rem] leading-none text-[var(--color-poster)]">Shaper</p>
                <Link
                  className="ui-heading mt-1.5 inline-block text-lg font-black uppercase leading-[0.9] tracking-[-0.03em] text-black/68 transition-colors hover:text-[var(--color-poster)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-poster)] sm:text-xl"
                  data-circle-shaper-profile-link
                  href={`/my/circle/people/${encodeURIComponent(circle.shaper.id)}`}
                >
                  {circle.shaper.displayName}
                </Link>
              </div>
            ) : null}
          </header>

          <section aria-labelledby="circle-members-title" className="mt-5 sm:mt-7">
            <h2 className="sr-only" id="circle-members-title">People in {circle.circle.name}</h2>
            <CircleMemberCluster members={visibleMembers} />
          </section>

          <CircleRoomCommunication
            chat={{
              href: circle.communication.chatHref,
              state: circle.communication.chatState,
            }}
            meeting={futureMeetings[0] ?? null}
          />

          <div className="mt-14 sm:mt-16">
            <section aria-labelledby="circle-resources-title" className="max-w-4xl">
              <h2 className="ui-heading text-[clamp(1.65rem,3vw,2.45rem)] font-black uppercase leading-[0.88] tracking-[-0.045em] text-[#191613]" id="circle-resources-title">
                Shared with your Circle
              </h2>
              {circle.resources.length ? (
                <ol className="mt-5 grid gap-4 sm:grid-cols-2">
                  {circle.resources.map((resource) => (
                    <li key={resource.id}>
                      <Link className="group block rounded-[4px] bg-black/[0.045] p-4 transition-colors hover:bg-black/[0.075] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-poster)] sm:p-5" href={resource.href}>
                        <p className="[font-family:var(--font-cadehandy2)] text-[1.25rem] leading-none text-[var(--color-poster)]">For the room</p>
                        <h3 className="ui-heading mt-2 text-xl font-black uppercase leading-[0.9] tracking-[-0.035em] text-black/78 sm:text-2xl">{resource.label}</h3>
                        {resource.description ? <p className="mt-2 font-[var(--font-body)] text-sm leading-relaxed text-black/52">{resource.description}</p> : null}
                        <span className="mt-4 inline-block font-[var(--font-body)] text-xs font-bold uppercase tracking-[0.04em] text-black/48 transition-colors group-hover:text-[var(--color-poster)]">Open →</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-4 max-w-md font-[var(--font-body)] text-sm leading-relaxed text-black/48">
                  Nothing has been shared with this Circle yet.
                </p>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
