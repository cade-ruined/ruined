import Link from "next/link";

import CircleMemberPortrait from "@/components/membership/CircleMemberPortrait";
import type { PrivacySafePersonSummary } from "@/lib/membership/model";

export type CirclePersonRole = "member" | "shaper";

function PersonPortrait({ person }: { person: PrivacySafePersonSummary }) {
  return (
    <figure aria-label={`${person.displayName} portrait`} className="relative aspect-square w-full overflow-hidden rounded-full bg-[var(--color-workwear)] shadow-[0_18px_42px_rgba(40,30,18,0.2)]">
      <CircleMemberPortrait
        imageClassName="object-cover saturate-[0.82] contrast-[1.04]"
        imageSizes="(min-width: 1024px) 390px, (min-width: 640px) 320px, 82vw"
        initialsClassName="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_68%_20%,rgba(255,255,255,0.28),transparent_35%),var(--color-workwear)] font-[var(--font-body)] text-5xl font-black tracking-[-0.05em] text-black/62"
        person={person}
        previewClassName="absolute inset-0 bg-[var(--color-workwear)] bg-no-repeat saturate-[0.8] contrast-[1.035]"
        priority
      />
    </figure>
  );
}

export default function CirclePersonProfile({
  circleName,
  person,
  role,
}: {
  circleName: string;
  person: PrivacySafePersonSummary;
  role: CirclePersonRole;
}) {
  return (
    <main className="member-profile-dossier mx-auto max-w-[72rem] pb-20 pt-2 sm:pb-24 sm:pt-4" data-circle-person-profile>
      <Link className="inline-flex min-h-11 items-center font-[var(--font-body)] text-xs font-bold uppercase tracking-[0.04em] text-black/52 transition-colors hover:text-[var(--color-poster)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--color-poster)]" href="/my/circle">
        ← Back to {circleName}
      </Link>

      <div className="mt-4 grid items-center gap-8 sm:grid-cols-[minmax(15rem,0.78fr)_minmax(0,1.22fr)] sm:gap-10 lg:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <PersonPortrait person={person} />

        <article className="min-w-0">
          <p className="[font-family:var(--font-cadehandy2)] text-[1.55rem] leading-none text-[var(--color-poster)] sm:text-[1.8rem]">
            {person.isSelf ? "You" : role === "shaper" ? "Shaper" : "Circle member"}
          </p>
          <h1 className="ui-heading mt-2 break-words text-[clamp(2.7rem,7vw,6.8rem)] font-black uppercase leading-[0.8] tracking-[-0.06em] text-[#15120f]">
            {person.displayName}
          </h1>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 font-[var(--font-body)] text-[0.68rem] font-bold uppercase tracking-[0.035em] text-black/48">
            <span>{circleName}</span>
            {person.location ? <span>{person.location}</span> : null}
          </div>

          {person.buildingNow ? (
            <div className="mt-7 max-w-2xl">
              <p className="[font-family:var(--font-cadehandy2)] text-[1.35rem] leading-none text-[var(--color-poster)]">What they&apos;re building</p>
              <p className="mt-2 font-[var(--font-display)] text-2xl leading-[1.04] tracking-[-0.025em] text-black/82 sm:text-3xl">{person.buildingNow}</p>
            </div>
          ) : null}
          {person.bio ? <p className="mt-5 max-w-xl font-[var(--font-body)] text-sm leading-relaxed text-black/58 sm:text-base">{person.bio}</p> : null}

          <div className="mt-7 flex flex-wrap gap-2.5 font-[var(--font-body)] text-xs font-bold uppercase tracking-[0.035em]">
            {person.email ? <a className="rounded-[4px] bg-[var(--color-faded)] px-4 py-3 text-[var(--color-bone)] transition-colors hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)]" href={`mailto:${person.email}`}>Email</a> : null}
            {person.phone ? <a className="rounded-[4px] bg-black/[0.055] px-4 py-3 text-black/72 transition-colors hover:bg-black/[0.09] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)]" href={`tel:${person.phone}`}>Call</a> : null}
            {person.isSelf ? <Link className="rounded-[4px] bg-[var(--color-highlight)] px-4 py-3 text-[#15120f] transition-colors hover:bg-[#f3bd18] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)]" href="/my/profile">Edit profile</Link> : null}
          </div>
        </article>
      </div>
    </main>
  );
}
