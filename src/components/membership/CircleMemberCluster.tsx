"use client";

import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";

import CircleMemberPortrait from "@/components/membership/CircleMemberPortrait";
import type { PrivacySafePersonSummary } from "@/lib/membership/model";

import styles from "./circle-member-cluster.module.css";

const positions = [
  { left: 16, size: 25, top: 4 },
  { left: 39, size: 27, top: 0 },
  { left: 64, size: 24, top: 7 },
  { left: 3, size: 24, top: 32 },
  { left: 25, size: 28, top: 27 },
  { left: 51, size: 25, top: 30 },
  { left: 74, size: 23, top: 35 },
  { left: 15, size: 25, top: 60 },
  { left: 39, size: 28, top: 59 },
  { left: 65, size: 25, top: 61 },
] as const;

function positionStyle(index: number): CSSProperties {
  const position = positions[index] ?? positions[positions.length - 1];
  return {
    "--cluster-left": `${position.left}%`,
    "--cluster-size": `${position.size}%`,
    "--cluster-top": `${position.top}%`,
  } as CSSProperties;
}

function MemberPortrait({
  person,
}: {
  person: PrivacySafePersonSummary;
}) {
  return (
    <CircleMemberPortrait
      imageClassName="object-cover saturate-[0.82] contrast-[1.04]"
      imageSizes="(min-width: 1024px) 170px, (min-width: 640px) 150px, 96px"
      initialsClassName={styles.initials}
      person={person}
      previewClassName={styles.previewPortrait}
    />
  );
}

export default function CircleMemberCluster({
  members,
}: {
  members: PrivacySafePersonSummary[];
}) {
  const visibleMembers = useMemo(() => members.slice(0, 10), [members]);
  const initialMemberId = visibleMembers.find((person) => person.isSelf)?.id
    ?? visibleMembers[0]?.id
    ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(initialMemberId);
  const selectedIndex = Math.max(0, visibleMembers.findIndex((person) => person.id === selectedId));
  const selected = visibleMembers[selectedIndex] ?? null;

  if (!selected) {
    return (
      <div className="rounded-[4px] bg-black/[0.045] px-5 py-10" data-circle-empty-roster>
        <p className="[font-family:var(--font-cadehandy2)] text-[1.45rem] leading-none text-[var(--color-poster)]">
          The room is forming
        </p>
        <p className="ui-heading mt-2 text-2xl font-black uppercase leading-[0.9] tracking-[-0.04em] text-black/72">
          No members are visible yet.
        </p>
      </div>
    );
  }

  return (
    <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(17rem,0.75fr)] lg:gap-10" data-circle-member-cluster>
      <ol aria-label="Circle members" className={styles.cluster} data-member-count={visibleMembers.length}>
        {visibleMembers.map((person, index) => {
          const selectedMember = person.id === selected.id;
          return (
            <li className={styles.member} data-circle-member key={person.id} style={positionStyle(index)}>
              <button
                aria-label={`View ${person.displayName}`}
                aria-pressed={selectedMember}
                className={styles.memberButton}
                data-self={person.isSelf ? "true" : undefined}
                onClick={() => setSelectedId(person.id)}
                type="button"
              >
                <span className={styles.photo}>
                  <MemberPortrait person={person} />
                </span>
                {person.isSelf ? <span className={styles.youBadge}>You</span> : null}
              </button>
            </li>
          );
        })}
      </ol>

      <article aria-live="polite" className="min-w-0 lg:pb-5" data-circle-member-profile>
        <p className="[font-family:var(--font-cadehandy2)] text-[1.45rem] leading-none text-[var(--color-poster)] sm:text-[1.65rem]">
          {selected.isSelf ? "You" : `Member ${String(selectedIndex + 1).padStart(2, "0")}`}
        </p>
        <h2 className="ui-heading mt-2 break-words text-[clamp(2rem,5vw,4.5rem)] font-black uppercase leading-[0.82] tracking-[-0.055em] text-[#15120f]">
          {selected.displayName}
        </h2>
        {selected.location ? (
          <p className="mt-3 font-[var(--font-body)] text-xs font-bold uppercase tracking-[0.035em] text-black/48">
            {selected.location}
          </p>
        ) : null}
        {selected.buildingNow ? (
          <div className="mt-6 max-w-lg">
            <p className="[font-family:var(--font-cadehandy2)] text-[1.28rem] leading-none text-[var(--color-poster)]">
              What they&apos;re building
            </p>
            <p className="mt-2 font-[var(--font-display)] text-xl leading-[1.06] tracking-[-0.02em] text-black/82 sm:text-2xl">
              {selected.buildingNow}
            </p>
          </div>
        ) : null}
        {selected.bio ? (
          <p className="mt-4 max-w-lg font-[var(--font-body)] text-sm leading-relaxed text-black/58">
            {selected.bio}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-2.5 font-[var(--font-body)] text-xs font-bold uppercase tracking-[0.035em]">
            <Link
              className="rounded-[4px] bg-[var(--color-highlight)] px-4 py-3 text-[#15120f] transition-colors hover:bg-[#f3bd18] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)]"
              data-circle-profile-link
              href={`/my/circle/people/${encodeURIComponent(selected.id)}`}
            >
              Profile
            </Link>
            {selected.email ? (
              <a className="rounded-[4px] bg-[var(--color-faded)] px-4 py-3 text-[var(--color-bone)] transition-colors hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)]" href={`mailto:${selected.email}`}>
                Email
              </a>
            ) : null}
            {selected.phone ? (
              <a className="rounded-[4px] bg-black/[0.055] px-4 py-3 text-black/72 transition-colors hover:bg-black/[0.09] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-poster)]" href={`tel:${selected.phone}`}>
                Call
              </a>
            ) : null}
          </div>
      </article>
    </div>
  );
}
