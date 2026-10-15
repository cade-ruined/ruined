"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";

import CircleMemberPortrait from "@/components/membership/CircleMemberPortrait";
import { circleClusterPositions, type CircleClusterPosition } from "@/lib/membership/circle-cluster-layout";
import type { PrivacySafePersonSummary } from "@/lib/membership/model";

import actions from "./CircleActions.module.css";
import styles from "./circle-member-cluster.module.css";

function positionStyle(position: CircleClusterPosition): CSSProperties {
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
  const visibleMembers = members;
  const positions = circleClusterPositions(visibleMembers.length, visibleMembers.findIndex((person) => person.isSelf));
  const initialMemberId = visibleMembers.find((person) => person.isSelf)?.id
    ?? visibleMembers[0]?.id
    ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(initialMemberId);
  const selectedIndex = Math.max(0, visibleMembers.findIndex((person) => person.id === selectedId));
  const selected = visibleMembers[selectedIndex] ?? null;

  if (!selected) {
    return (
      <div className="rounded-[4px] bg-[var(--member-soft)] px-5 py-10" data-circle-empty-roster>
        <p className="[font-family:var(--font-cadehandy2)] text-[1.45rem] leading-none text-[var(--member-red)]">
          The room is forming
        </p>
        <p className="ui-heading mt-2 text-2xl font-black uppercase leading-[0.9] tracking-[-0.04em] text-[var(--member-muted)]">
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
            <li className={styles.member} data-circle-member data-self={person.isSelf ? "true" : undefined} key={person.id} style={positionStyle(positions[index])}>
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
        <p className="[font-family:var(--font-cadehandy2)] text-[1.45rem] leading-none text-[var(--member-red)] sm:text-[1.65rem]">
          {selected.isSelf ? "You" : `Member ${String(selectedIndex + 1).padStart(2, "0")}`}
        </p>
        <h2 className="ui-heading mt-2 break-words text-[clamp(2rem,5vw,4.5rem)] font-black uppercase leading-[0.82] tracking-[-0.055em] text-[var(--member-ink)]">
          {selected.displayName}
        </h2>
          {selected.memberTag && selected.displayName !== `@${selected.memberTag}` ? <p className="mt-3 break-all font-[var(--font-body)] text-sm text-[var(--member-muted)]">@{selected.memberTag}</p> : null}
        {selected.location ? (
          <p className="mt-3 font-[var(--font-body)] text-xs font-bold uppercase tracking-[0.035em] text-[var(--member-muted)]">
            {selected.location}
          </p>
        ) : null}
        {selected.buildingNow ? (
          <div className="mt-6 max-w-lg">
            <p className="[font-family:var(--font-cadehandy2)] text-[1.28rem] leading-none text-[var(--member-red)]">
              What they&apos;re building
            </p>
            <p className="mt-2 font-[var(--font-display)] text-xl leading-[1.06] tracking-[-0.02em] text-[var(--member-muted)] sm:text-2xl">
              {selected.buildingNow}
            </p>
          </div>
        ) : null}
        {selected.bio ? (
          <p className="mt-4 max-w-lg font-[var(--font-body)] text-sm leading-relaxed text-[var(--member-muted)]">
            {selected.bio}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-2.5 font-[var(--font-body)] text-xs font-bold uppercase tracking-[0.035em]">
            <Link
              className={`${actions.action} ${actions.primary}`}
              data-circle-profile-link
              href={selected.publicProfileHref ?? `/my/circle/people/${encodeURIComponent(selected.id)}`}
            >
              {selected.publicProfileHref ? "Public profile" : "Circle profile"}
            </Link>
            {selected.email ? (
              <a className={`${actions.action} ${actions.secondary}`} href={`mailto:${selected.email}`}>
                Email
              </a>
            ) : null}
            {selected.phone ? (
              <a className={`${actions.action} ${actions.secondary}`} href={`tel:${selected.phone}`}>
                Call
              </a>
            ) : null}
          </div>
      </article>
    </div>
  );
}
